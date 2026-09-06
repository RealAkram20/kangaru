<?php

namespace Modules\Customers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Customers\Requests\CancelRideRequest;
use Modules\Customers\Requests\StoreRideExtensionRequest;
use Modules\Customers\Resources\CustomerRideResource;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Notifications\Notifications\TripExtensionRequestedNotification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Models\Trip;
use Modules\Trips\Resources\TripStopResource;
use Modules\Trips\Services\TripStateMachine;
use Modules\Trips\Services\TripStopService;

/**
 * The ride a customer is currently waiting on or taking (ADR-0024 §7).
 *
 * ## Why "the active one" rather than an id
 *
 * `frontend/src/pages/public/ride.ts` runs the customer's screen off a
 * simulation today, and the screen holds a **reference** — `KR-XXXXXX` — not
 * an id, because ADR-0012 deliberately gave the public order endpoint no id
 * to return: *"it returns nothing but the reference — no id, no echo of the
 * stored row, nothing enumerable."*
 *
 * Keying this endpoint by the reference would undo that. A `KR-` code is six
 * readable characters and ADR-0012 rejected a public status checker over
 * exactly that guessability; adding one behind a customer token would still
 * mean a caller supplying somebody else's code and finding out whether it
 * resolves.
 *
 * So the customer asks for **their own** current ride and supplies nothing.
 * There is no identifier in the request to tamper with, which is the same
 * reasoning `/me/duty` and `/me/offers` use on the driver's side.
 *
 * ## No policy class
 *
 * The scope is the authorization, exactly as in
 * `CustomerOrderRequestController`: the query starts from the token's own
 * `customer_id`, so there is no "may this customer see that ride" question
 * left for a policy to get wrong.
 */
class CustomerRideController extends Controller
{
    public function __construct(
        private readonly TripStateMachine $stateMachine,
        // Only for the withdrawal push on cancellation (ADR-0046 §4). This
        // controller deliberately does not reach the matcher for anything
        // else — a cancelling passenger has no dispatch decision to make.
        private readonly DispatchOfferService $offers,
    ) {}

    /**
     * The customer's current ride, or null when they have none.
     *
     * 200 with a null body rather than 404, and the difference matters to
     * the screen: "you have no ride in progress" is a state it renders, and
     * a 404 is an error it would have to translate into that state — which
     * means a genuinely broken request would render as "no ride" too.
     */
    public function active(Request $request): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        $ride = $this->activeRideFor($customer);

        if ($ride === null) {
            return ApiResponse::success(null, 'No ride in progress.');
        }

        $trip = $this->tripFor($customer, $ride);

        // A finished ride stops being "active", so the screen returns to the
        // order form rather than showing yesterday's captain.
        //
        // `occupiesVehicle()`, **not** `isTerminal()`, and the difference is
        // the whole point. `isTerminal()` is about the *billing* lifecycle:
        // `trip_completed` is not terminal because `invoice_generated`
        // follows it, so a customer dropped at their destination would have
        // gone on watching a live ride screen through invoicing and dispute
        // resolution — possibly for days.
        //
        // `occupiesVehicle()` already draws exactly the line this needs, and
        // its own docblock says why: occupancy "ends at Trip Completed — the
        // vehicle is physically free the moment the passenger is dropped,
        // even though Invoice Generated / Disputed / Closed still follow on
        // the billing side". A vehicle that is free is a journey that is
        // over, which is the question the ride screen is asking.
        //
        // **Except for a short while after it ends.** The screen has to *see*
        // the ending to render it — the fare and the rating after a drop-off,
        // the notice after a cancellation — and a null the instant the trip
        // stopped occupying the vehicle meant it never did: the poll ignores
        // null on purpose (holding the last state rather than snapping back to
        // "searching"), so the passenger sat on "on trip" after the driver had
        // completed, and on "captain assigned" after they had cancelled. The
        // owner watched both. `AFTERGLOW_MINUTES` is the window; after it, a
        // reload shows the order form and yesterday's captain stays yesterday's.
        if ($trip !== null && ! $trip->status->occupiesVehicle() && ! $this->justEnded($trip)) {
            return ApiResponse::success(null, 'No ride in progress.');
        }

        // Set explicitly so the resource reads the trip resolved below
        // rather than triggering `$ride->trip`, which would go through the
        // tenant scope and come back null. See `tripFor()`.
        $ride->setRelation('trip', $trip);

        return ApiResponse::success(new CustomerRideResource($ride), 'Your ride.');
    }

    /**
     * The passenger calls the ride off (ADR-0024 §7).
     *
     * ## Two different acts behind one button
     *
     * Before a captain is assigned there is no trip, only an order the
     * matcher is working — so cancelling *closes the order* and supersedes
     * whatever offer happens to be out. After one is assigned there is a real
     * trip holding a real driver and vehicle, and cancelling has to release
     * them through `TripStateMachine` like every other status write.
     *
     * The customer taps one control and should not have to know which of
     * those they are doing, so this endpoint decides.
     *
     * ## What it refuses, and why that is not a bug
     *
     * `TripStatus` has no edge from `trip_started` to `cancelled`. A journey
     * under way ends by being finished, not by being called off, and the
     * odometer reading that opens it is evidence that cannot be un-booked.
     * A passenger who needs out mid-journey is having a conversation with
     * their driver, not pressing a button — so this answers 409 and says so
     * plainly rather than pretending.
     *
     * ## What it deliberately does not decide
     *
     * Whether anybody is charged. ADR-0024 defers walk-in cancellation
     * charges by name — who pays what when a ride is called off ninety
     * seconds before pickup is a commercial decision nobody has made — so
     * `cancellation_charge_applicable` is left null, which is the column's
     * own way of saying "undecided". Writing `false` here would quietly make
     * that decision on the operator's behalf, for every ride, forever.
     */
    public function cancel(CancelRideRequest $request): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        $ride = $this->activeRideFor($customer);

        if ($ride === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'You have no ride in progress to cancel.',
                [],
                404,
            );
        }

        $reason = $request->string('reason')->value() ?: null;
        $trip = $this->tripFor($customer, $ride);

        if ($trip !== null && ! $trip->status->occupiesVehicle()) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'You have no ride in progress to cancel.',
                [],
                404,
            );
        }

        if ($trip !== null && ! $trip->status->canTransitionTo(TripStatus::CANCELLED)) {
            return ApiResponse::error(
                ErrorCode::INVALID_TRIP_TRANSITION,
                'Your trip has already started, so it cannot be cancelled here. '
                .'Please speak to your Captain.',
                [],
                409,
            );
        }

        DB::transaction(function () use ($ride, $trip, $reason) {
            if ($trip !== null) {
                $this->stateMachine->transition(
                    $trip,
                    TripStatus::CANCELLED,
                    // No staff user did this — the passenger did. See
                    // `TripStateMachine::transition` for why that is a null
                    // rather than a stand-in account.
                    null,
                    ['notes' => $this->cancellationNote($reason)],
                );
            }

            // Every offer still out on this order is dead. Only reachable
            // before a captain was assigned, and written for the case where
            // `offer_wave_size` is above one.
            //
            // Read before the update, because `->live()` is what finds them
            // and the update is what stops them being live.
            $withdrawn = DispatchOffer::query()
                ->where('order_request_id', $ride->id)
                ->live()
                ->with('driver.user')
                ->get();

            DispatchOffer::query()
                ->whereKey($withdrawn->modelKeys())
                ->update([
                    'status' => DispatchOfferStatus::SUPERSEDED,
                    'responded_at' => now(),
                ]);

            // **The case this was written for.** A passenger cancelling is the
            // one path that kills an offer while a driver's phone is actively
            // ringing for it, and with a forty-five second window that is the
            // better part of a minute of noise over a ride nobody is taking.
            // Best-effort — the handset's own deadline is the guarantee
            // (ADR-0046 §4).
            $this->offers->withdraw($withdrawn);

            // A converted order keeps its status — the trip carries the
            // cancellation and `converted` has nowhere legal to go. An order
            // still in the queue is closed, so the matcher stops working it
            // and the desk does not ring somebody who changed their mind.
            if (in_array($ride->status, [OrderRequestStatus::NEW, OrderRequestStatus::CONTACTED], true)) {
                $ride->forceFill([
                    'status' => OrderRequestStatus::CLOSED,
                    'dispatcher_notes' => $this->cancellationNote($reason),
                ])->save();
            }
        });

        return ApiResponse::success(null, 'Your ride has been cancelled.');
    }

    private function cancellationNote(?string $reason): string
    {
        return $reason === null
            ? 'Cancelled by the passenger.'
            : "Cancelled by the passenger: {$reason}";
    }

    /**
     * The order this customer is currently watching, or null.
     *
     * Shared by `active()` and `cancel()` precisely so the two cannot
     * disagree about which ride the customer means — the cancel button sits
     * on the screen the other one renders.
     */
    /** How long a finished ride stays on the passenger's screen. */
    private const AFTERGLOW_MINUTES = 30;

    /**
     * Whether the trip stopped occupying the vehicle recently enough that the
     * passenger is still looking at it.
     *
     * `updated_at` rather than `completed_at`: a cancellation writes no
     * `completed_at`, and the status write is the last thing that touches the
     * row either way. A persisted trip always carries one, so there is no
     * null case to guard.
     */
    private function justEnded(Trip $trip): bool
    {
        return $trip->updated_at->gt(now()->subMinutes(self::AFTERGLOW_MINUTES));
    }

    /**
     * The passenger asking to be taken somewhere further.
     *
     * ## A request, not an instruction
     *
     * This is the one of the three ways to extend a trip that does not take
     * effect on its own. A driver or a dispatcher adding an extension is
     * recording a decision already taken; a passenger tapping in the back
     * seat is *asking*, and it changes where the driver is going and what
     * they are owed. `TripStopService::addExtension` reads the source and
     * lands this one `PROPOSED`, which nothing routes through and nothing
     * bills until the driver answers.
     *
     * ## Why the trip has to be running
     *
     * The same 404 as everything else here, in the same words. A passenger
     * whose ride has finished has no trip to extend, and one whose driver is
     * still on the way has nowhere to be extended *to* — the journey has not
     * begun, so "further than the drop-off" has no meaning yet.
     * `TripStopService::ACTIVE_STATUSES` is the same gate the staff surface
     * uses, so the two cannot drift.
     */
    public function extend(StoreRideExtensionRequest $request, TripStopService $stops): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        $ride = $this->activeRideFor($customer);
        $trip = $ride === null ? null : $this->tripFor($customer, $ride);

        if ($trip === null || ! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'You have no ride in progress to extend.',
                [],
                404,
            );
        }

        $extension = $stops->addExtension(
            $trip,
            $request->validated(),
            // No staff user did this — the passenger did, and a `Customer` is
            // not a `users` row. `TripStopService` stores a null and lets
            // `ADDED_BY_CLIENT` carry the answer.
            null,
            TripStopSource::ADDED_BY_CLIENT,
        );

        /*
         * **The half of this that reaches a person.**
         *
         * A proposal that nobody is told about is a passenger waiting on an
         * answer their driver has no way of knowing was asked for — they
         * would find it by opening the trip and noticing. Notified rather
         * than pushed directly so the channel choice stays in
         * `NotificationType`, which sends this on push and the in-app row and
         * never on mail.
         *
         * The driver's *user*, not the driver record: notifications are
         * addressed to accounts. A trip with no driver on it cannot reach
         * this line — `ACTIVE_STATUSES` means the journey is under way — but
         * the null-safe call says so rather than trusting it.
         */
        $trip->driver?->user?->notify(TripExtensionRequestedNotification::for($extension));

        return ApiResponse::success(
            new TripStopResource($extension),
            'Your Captain has been asked to take you on.',
            201,
        );
    }

    private function activeRideFor(Customer $customer): ?OrderRequest
    {
        return OrderRequest::query()
            ->where('customer_id', $customer->id)
            // Rides and deliveries only. This screen is a captain search and a
            // live map, and a self-drive rental has neither — it was rendering
            // "Finding you a captain" over a five-day hire and then, once the
            // retry window closed, "no captain found" for something no captain
            // was ever going to drive. The same distinction dispatch now makes
            // (`OrderRequestServiceType::dispatchesToDriver`), so the screen
            // and the matcher agree about what is being searched for.
            ->whereIn('service_type', OrderRequestServiceType::dispatchableToDriver())
            // Immediate rides only. A booking for next Tuesday is not
            // something to show a live map for, and ADR-0024 does not offer
            // scheduled rides to drivers yet either — the two agree on
            // purpose, so the screen never waits for a search that is not
            // running.
            ->where(fn ($q) => $q->whereNull('scheduled_for')->orWhere('scheduled_for', '<=', now()))
            // Newest first: a customer who ordered twice is watching the one
            // they just placed.
            ->latest('id')
            ->first();
    }

    /**
     * This customer's trip for this order, resolved past the tenant scope.
     *
     * ## Why `$ride->trip` cannot be used here
     *
     * `Trip` carries `BelongsToTenant`, whose global scope **fails closed**:
     * with no tenant bound it applies `1 = 0` and matches nothing. A
     * customer never has a tenant bound, because a customer has no tenant —
     * so `$ride->trip` returns null for every walk-in ride, and so does a
     * `whereHas('trip', …)` filter.
     *
     * That was not theorised. The first version of this endpoint used
     * `whereHas` and `with('trip.driver')` and answered `data: null` for a
     * ride that plainly existed, with no error anywhere — the scope did
     * exactly what ADR-0001 designed it to do, to the one principal it was
     * never designed for.
     *
     * `Trip::forCustomer()` is the named way past it, added by ADR-0024 §1
     * as the counterpart to `BelongsToTenant::forActor`. Reaching for
     * `allTenants()` instead would be the raw opt-out that trait's docblock
     * now calls a review failure — and, more importantly, `forCustomer` also
     * narrows to this customer's own rows, so the scope it drops is replaced
     * by a tighter one rather than by nothing.
     *
     * The eager loads are here because the captain card needs the driver and
     * the vehicle, and this screen polls every few seconds — three queries
     * per render is the N+1 AGENTS.md forbids.
     */
    private function tripFor(Customer $customer, OrderRequest $ride): ?Trip
    {
        if ($ride->trip_id === null) {
            return null;
        }

        return Trip::forCustomer($customer)
            ->with(['driver', 'vehicle'])
            ->find($ride->trip_id);
    }
}
