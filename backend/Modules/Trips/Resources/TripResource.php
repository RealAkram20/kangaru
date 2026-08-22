<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Support\OrderDetails;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Resources\DriverLedgerEntryResource;
use Modules\Drivers\Resources\DriverResource;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\ContactChannel;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * @mixin Trip
 */
class TripResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Null on a walk-in trip (ADR-0024 §1), where `customer_id`
            // carries the ownership instead. Exactly one of the pair is ever
            // set, so a client can branch on either without asking both.
            'tenant_id' => $this->tenant_id,
            'customer_id' => $this->customer_id,
            // Which client this trip is for, by name. See BookingResource
            // for the reasoning — same rule, same ADR-0006 queue, and a
            // trips list opened by platform staff spans clients too.
            'client' => $this->whenLoaded('tenant', function () {
                // See BookingResource — same shape, same reason for the
                // local and the null branch.
                $client = $this->tenant;

                return $client === null ? null : ['id' => $client->id, 'name' => $client->name];
            }),
            // Null on an ad-hoc trip raised without a booking.
            'booking_id' => $this->booking_id,
            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'driver_id' => $this->driver_id,
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'origin' => $this->origin,
            'destination' => $this->destination,
            // The same two places again, with coordinates where the platform
            // has them. `origin`/`destination` stay exactly as they were —
            // AGENTS.md allows additive changes but no removals, and every
            // client already reads them.
            'pickup' => $this->place(
                $this->origin,
                $this->order()?->pickup_latitude,
                $this->order()?->pickup_longitude,
            ),
            'dropoff' => $this->place(
                $this->destination,
                $this->order()?->dropoff_latitude,
                $this->order()?->dropoff_longitude,
            ),
            /*
             * The run's itinerary, in order (ADR-0045). Empty for every
             * point-to-point trip, which is every trip that existed before
             * stops did — an empty list, not an absence, so a client can
             * render "no stops" without a null branch.
             *
             * `whenLoaded`, and `show()` loads it where `index()` does not —
             * the same bound `orderRequest` and `ledgerEntries` carry. A
             * dispatch board of fifty trips must not pay fifty itinerary
             * queries for a column nobody renders there.
             */
            'stops' => TripStopResource::collection($this->whenLoaded('stops')),
            // §4's flag: how many stops were added mid-run rather than
            // planned. A note, not a charge — the client sees the run
            // deviated and where; nobody bills for the deviation.
            //
            // Cast, because a model that was just create()d has never read
            // the column's database default back and would serve null for a
            // count that is honestly zero.
            'unplanned_stop_count' => (int) $this->unplanned_stop_count,
            /*
             * What kind of job this was — `ride`, `delivery` or `self_drive`.
             *
             * A real column on the order request, not a key inside `details`,
             * so nothing here goes near the JSON that carries the two withheld
             * phone numbers. Null on a trip with no walk-in order behind it,
             * which is every corporate booking: a client's trip is whatever
             * their contract says it is, and this platform does not classify it.
             *
             * The driver app's trip record needs it for the same reason the
             * wallet statement does — a delivery and a ride are different jobs,
             * and one screen that says neither reads as a screen about nothing.
             */
            'service_type' => $this->order()?->service_type->value,
            /*
             * The reference the customer was given, and the one they quote.
             *
             * `order_requests.reference` — a unique twelve-character column
             * that has existed since ADR-0012 and had no way out onto a trip.
             * It is served here so the driver and the office are reading the
             * same identifier when somebody rings about this job; a database
             * id is ours, a reference is theirs.
             *
             * Null on a corporate trip, which has a booking rather than an
             * order. The app falls back to the trip's own number and says which
             * it is showing.
             */
            'reference' => $this->order()?->reference,
            /*
             * What was in the parcel, on a delivery — nothing on a ride.
             *
             * Allow-listed through `OrderDetails::packageFor()`, the single
             * reader of `order_requests.details`. The rule about *when* the
             * parcel fields are released lives there rather than here for the
             * reason that class documents at length: this column also holds
             * `sender_phone` and `recipient_phone`, and a second copy of the
             * guard is the copy that misses the next key.
             */
            'package' => OrderDetails::packageFor($this->order()),
            'status' => $this->status->value,
            // Served so the UI never has to carry its own copy of the
            // transition graph. TripStatus stays the single source of
            // truth (AGENTS.md: "Allowed transitions are defined in one
            // place"), and a client that duplicated the map would drift
            // from it the first time the lifecycle changed.
            //
            // This is what is *legal from this state*, not what this user
            // may do — TripPolicy still authorises each attempt.
            'allowed_transitions' => array_map(
                fn (TripStatus $status) => $status->value,
                $this->status->allowedTransitions(),
            ),
            // What the driver app's waiting ring fills against, in seconds
            // — served for the same reason `allowed_transitions` above is,
            // and `presence_heartbeat_seconds` before it: a number the app
            // hardcoded is a number that needs a store release to argue
            // with, on handsets nobody can reach.
            //
            // **Not a deadline, and nothing expires when it elapses.** See
            // `config/dispatch.php` — no waiting charge, no `no_show`, no
            // sweep. The app fills the ring to full and holds it there.
            'pickup_wait_target_seconds' => (int) config('dispatch.pickup_wait_target_seconds'),
            /*
             * The ceiling the closing reading will be judged against
             * (ADR-0035), so the app can refuse an impossible number before it
             * queues one.
             *
             * Served for exactly the reason `pickup_wait_target_seconds` above
             * is, and the reason matters more here: the office can change this
             * in the console, and a handset holding its own copy would go on
             * enforcing the old number on devices nobody can reach. That is
             * the defect this repository already records once — a server
             * threshold hardcoded into a shipped app.
             *
             * On the trip rather than a config endpoint because the app is
             * offline-first: the trip is already cached on the handset, so the
             * limit is there in a dead zone, which is exactly where a driver
             * finishes a job and types a reading.
             *
             * **The server still enforces it.** This is a courtesy so the
             * driver is told at the keypad instead of by a parked outbox item
             * hours later; it is not the control.
             */
            'odometer_max_km_per_trip' => (int) app(SettingsService::class)
                ->get('tracking', 'odometer_max_km_per_trip'),
            'odometer_start' => $this->odometer_start,
            'odometer_start_photo_path' => $this->odometer_start_photo_path,
            'odometer_end' => $this->odometer_end,
            'odometer_end_photo_path' => $this->odometer_end_photo_path,
            // Where to fetch the dashboard photos, rather than leaving a
            // client to build the path itself. Null when none was captured,
            // so "is there a photo" is one field rather than a string test.
            //
            // The `_path` fields above are kept alongside these: AGENTS.md
            // allows additive changes within a version but not removals, and
            // dropping them would break any client already reading them.
            'odometer_start_photo_url' => $this->odometer_start_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'start']),
            'odometer_end_photo_url' => $this->odometer_end_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'end']),
            'distance_km' => $this->distance_km,
            'gps_distance_km' => $this->gps_distance_km,
            'distance_variance_flagged' => $this->distance_variance_flagged,
            'cancellation_charge_applicable' => $this->cancellation_charge_applicable,
            'started_at' => $this->started_at,
            'completed_at' => $this->completed_at,
            // Bank acceptance criterion #6. Served explicitly rather than
            // left for each client to re-derive from the two timestamps.
            'duration_minutes' => $this->durationMinutes(),
            // What was actually charged, once anybody drove it (ADR-0026
            // §2). Null until `WalkInFareService::settle()` runs at
            // completion, and null forever on a corporate trip — a client's
            // work is invoiced, and there is no per-trip cash fare to show.
            'fare' => $this->settledFare(),
            // What it is *expected* to fetch, before that. A quote and a
            // settlement are different things and they are different fields
            // for that reason — see `estimatedFare()`.
            'estimated_fare' => $this->estimatedFare(),
            // How this job settles, for the driver who is carrying it.
            //
            // The same fact `DispatchOfferResource` puts on the offer card,
            // served again here because an offer is answered in fifteen
            // seconds and the drop-off can be an hour later: a driver who has
            // forgotten whether this one is cash should not have to remember.
            // A driver carrying no float needs it before they arrive, not at
            // the kerb.
            'payment' => $this->paymentFor(),
            // What the driver made on it, for that driver alone. The fare
            // above is what the passenger paid; this is what is left after
            // the platform's cut, read back from the ledger that recorded it
            // rather than recomputed. See below.
            'earnings' => $this->driverEarningsFor($request),
            // Who to ring, if anybody (ADR-0024 §7). Null far more often
            // than not — see below.
            'passenger_contact' => $this->passengerContactFor($request),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * The passenger's number, for the driver on this trip and nobody else.
     *
     * Three gates, and only the third is in this method:
     *
     * - **`ContactChannel` decides whether the trip is one where the parties
     *   may speak at all** — walk-in only, and only from `accepted` to
     *   `trip_completed`. That policy lives in one class because the
     *   customer's ride payload asks the same question, and a rule split
     *   across two resources is a rule applied to one and a half of them.
     * - **This method decides whether the *caller* is the driver.** A
     *   dispatcher listing trips holds `trips.view.all` and can already see
     *   the whole board; that does not make a passenger's mobile number part
     *   of a list view. It is served to the one person who needs to ring
     *   the passenger to find them at a busy pickup.
     * - The customer guard never reaches this resource at all.
     *
     * Note it is keyed off `driver->user_id`, the same ownership test
     * `TripPolicy::transition` uses. That relation is loaded on every path
     * that serves this resource; where it is not, `?->` yields null and the
     * field is withheld — which fails closed, and is the right direction for
     * a field like this one to fail in.
     *
     * @return array<string, string>|null
     */
    private function passengerContactFor(Request $request): ?array
    {
        $user = $request->user();

        if ($user === null || $this->driver?->user_id !== $user->id) {
            return null;
        }

        /** @var Trip $trip */
        $trip = $this->resource;

        return app(ContactChannel::class)->forPassenger($trip)?->toArray();
    }

    /**
     * The driver's own share of this trip, for the driver who drove it.
     *
     * ## Why this exists at all
     *
     * The figure was already in the database and had no way out. ADR-0029's
     * ledger records a `fare_earned` entry per completed walk-in trip, keyed
     * by `trip_id`, but the only HTTP surface over it is `GET /me/stats`,
     * which serves *aggregates* — today's earnings and the running balance.
     * So the one screen that has to answer "what did I just make" could not.
     *
     * The two alternatives were both worse, and both are the kind of thing
     * `docs/screen-rules.md` exists to stop:
     *
     * - **Show the gross fare and call it earnings.** It is the passenger's
     *   payment, not the driver's income, and on a 20% commission it
     *   overstates by a quarter. `FareEstimate`'s docblock in the driver app
     *   warned about exactly this confusion before there was a commission
     *   model to be confused about.
     * - **Compute `fare × (100 − percent)` on the handset.** That copies
     *   `billing.driver_commission_percent` — a runtime setting the Super
     *   Admin can change — into every installed phone, where it goes on being
     *   the old number until the driver updates the app.
     *
     * ## The commission is derived, never recomputed
     *
     * `commission_minor` is `gross − earned`, which is what ADR-0029 §2 says
     * it is: the ledger deliberately has no `commission` entry, because
     * pairing one with the credit double-counts. Deriving it from the two
     * figures that were actually written means the rate in force *at
     * completion* is what shows, years later, whatever the setting says now.
     * Nothing here reads the percent, and the percent is deliberately not
     * served — a client that displayed it would be stating a rule it does not
     * own.
     *
     * ## Three gates, and it fails closed on all of them
     *
     * - **The caller must be this trip's driver.** Same ownership test as
     *   `passengerContactFor()` and `TripPolicy::transition` — keyed off
     *   `driver->user_id`. A dispatcher holding `trips.view.all` sees the
     *   board; what a driver takes home is not part of a list view, and a
     *   corporate client must never see the platform's margin on their work.
     * - **The relation must have been eager-loaded.** Unbounded per row, so
     *   `show()` loads it and `index()` does not — the same bound
     *   `estimatedFare()` documents. Unloaded yields null rather than a
     *   lazy query, which is what keeps a dispatch board at one query.
     * - **There must be an entry.** Null on every corporate trip (no
     *   `fare_minor`, so ADR-0029 §4 raises no pair), and null in the window
     *   between completion and the listener running. The driver app renders
     *   that as an em dash and says the office has not confirmed it yet —
     *   never as a zero, which would read as an unpaid morning.
     *
     * @return array<string, mixed>|null
     */
    private function driverEarningsFor(Request $request): ?array
    {
        $user = $request->user();

        if ($user === null || $this->driver?->user_id !== $user->id) {
            return null;
        }

        if ($this->fare_minor === null || ! $this->relationLoaded('ledgerEntries')) {
            return null;
        }

        $earned = $this->ledgerEntries->firstWhere('kind', LedgerEntryKind::FARE_EARNED);

        if ($earned === null) {
            return null;
        }

        $gross = (int) $this->fare_minor;
        $share = (int) $earned->amount_minor;

        return [
            /*
             * Every movement this trip made in the driver's wallet, oldest
             * first — the fare share, a tip the office confirmed (ADR-0034), a
             * peak uplift (ADR-0036), a bonus, and the cash counterpart on a
             * cash job.
             *
             * ## Why the whole row and not just an amount
             *
             * These are `DriverLedgerEntryResource`s, the identical shape the
             * wallet statement already serves — so the driver app renders them
             * with `StatementRow`, the component it already has, and a tip on
             * this screen is worded exactly as the same tip is worded in the
             * wallet. AGENTS.md's rule against duplicating UI applies to the
             * payload that feeds it: two shapes for one fact about somebody's
             * pay is two vocabularies to keep in step.
             *
             * `description` is the load-bearing field. ADR-0029 §3 freezes the
             * commission rate that applied *in that string*, which is what lets
             * a driver open a trip from March and see the rate that actually
             * governed it.
             *
             * ## The service map is one entry, and it is built the cheap way
             *
             * `DriverLedgerEntryResource` labels a row "Ride earnings" rather
             * than "Fare earned" from a trip-id → service-type map, because
             * `->with('trip.orderRequest')` **silently returns nothing** on a
             * walk-in: `TenantScope` fails closed, and a customer-owned trip
             * has no tenant bound. Here the answer is already in hand — this is
             * that trip — so the map is a single pair and no query is needed.
             */
            'lines' => $this->earningLines(),
            'earned_minor' => $share,
            // Never negative, whatever the data says: a commission larger
            // than the fare is not a thing the ledger can produce, and if it
            // somehow did, showing the driver a negative fee would be a worse
            // answer than showing them the arithmetic that was recorded.
            'commission_minor' => $gross - $share,
            // The gross is repeated here rather than left to be read off
            // `fare` above, so the three figures a driver reconciles arrive
            // as one object. A screen that had to pair two nullable blocks to
            // show a subtraction would render half a sum whenever one of them
            // was missing.
            'total_minor' => $gross,
            'currency' => $earned->currency,
            'recorded_at' => $earned->created_at?->toIso8601String(),
        ];
    }

    /**
     * The ledger rows this trip wrote, oldest first.
     *
     * Only reached from `driverEarningsFor()`, which has already checked that
     * the caller is this trip's driver and that the relation was eager-loaded —
     * so this method carries no gate of its own and must not be called from
     * anywhere else.
     *
     * **The service-type map is a single pair, and it is absent rather than
     * empty when there is no order.** `DriverLedgerEntryResource` reads
     * `$map[$tripId] ?? null` and falls back to the kind's own label, so a
     * missing key means "we do not know what kind of job this was" and an empty
     * string would mean "it was a job of kind ''" — which would reach the
     * handset as a row titled " earnings".
     *
     * @return Collection<int, DriverLedgerEntryResource>
     */
    private function earningLines(): Collection
    {
        $serviceType = $this->order()?->service_type->value;
        $serviceTypes = $serviceType === null ? [] : [$this->id => $serviceType];

        return $this->ledgerEntries
            ->sortBy('id')
            ->values()
            ->map(fn (DriverLedgerEntry $entry) => new DriverLedgerEntryResource($entry, $serviceTypes));
    }

    /**
     * One end of the journey, in prose and — where the platform has it — in
     * coordinates.
     *
     * The label always exists, because `trips.origin` is not nullable. The
     * coordinates come from the walk-in order behind the trip and are null
     * on every corporate trip, on any order a dispatcher keyed in over the
     * phone, and whenever the relation was not loaded.
     *
     * **A null pair renders as no map, never as a map centred on 0°,0°.**
     * That point is in the Atlantic off Ghana, which is also where a
     * latitude/longitude swap lands a Kampala vehicle — see `Coordinates` in
     * the driver app, and ADR-0020, which records this codebase hitting that
     * swap for real.
     *
     * @return array{label: string, latitude: float|null, longitude: float|null}
     */
    private function place(string $label, ?float $latitude, ?float $longitude): array
    {
        // Both or neither. A half-resolved position is worse than none: one
        // coordinate with the other missing is not a place, and a client that
        // defaulted the absent half to zero would draw the vehicle in the
        // Atlantic — the same failure ADR-0020 records this codebase hitting
        // through a latitude/longitude swap.
        $located = $latitude !== null && $longitude !== null;

        return [
            'label' => $label,
            'latitude' => $located ? $latitude : null,
            'longitude' => $located ? $longitude : null,
        ];
    }

    /**
     * How this job settles — the method, and which end pays.
     *
     * Read through `OrderDetails`, which is the **one** reader of
     * `order_requests.details` in this codebase. That column also carries
     * `sender_phone` and `recipient_phone`, so a resource that emitted it
     * wholesale would leak two personal numbers ADR-0024 §7 withholds, and
     * would look entirely innocent in review under a field called `details`.
     * The allow-list is why this is three lines rather than a spread.
     *
     * **Null means "this trip has no walk-in order behind it", and that is a
     * real answer rather than a gap.** A corporate trip is invoiced to the
     * client under ADR-0024 §7's closing paragraph — there is no per-trip
     * settlement for a driver to collect, so a payment row on one would be
     * inventing a transaction.
     *
     * It is also null wherever `orderRequest` was not eager-loaded, which is
     * every list endpoint — the same bound `estimated_fare` carries and for
     * the same reason. The driver app reads this only on `show`.
     *
     * Note the shape differs from `DispatchOfferResource::payment()`, which
     * always returns an object with possibly-null members. An offer always has
     * an order behind it; a trip may genuinely not, and collapsing those two
     * cases into "an object full of nulls" would tell a driver on a corporate
     * job that nobody had said how it settles.
     *
     * @return array<string, string|null>|null
     */
    private function paymentFor(): ?array
    {
        $order = $this->order();

        if ($order === null) {
            return null;
        }

        return OrderDetails::allowed($order, OrderDetails::PAYMENT_FIELDS);
    }

    /** The walk-in order behind this trip, only if it was eager-loaded. */
    private function order(): ?OrderRequest
    {
        return $this->relationLoaded('orderRequest') ? $this->orderRequest : null;
    }

    /**
     * The fare that was actually charged, or null.
     *
     * Carries the version that priced it, because ADR-0026 and AGENTS.md's
     * money rules both turn on a figure being re-derivable years later: a
     * total with no rate card behind it is a number nobody can defend when
     * somebody disputes it.
     *
     * @return array<string, mixed>|null
     */
    private function settledFare(): ?array
    {
        if ($this->fare_minor === null) {
            return null;
        }

        return [
            'total_minor' => $this->fare_minor,
            'currency' => $this->fare_currency,
            'rate_card_version_id' => $this->fare_rate_card_version_id,
            'computed_at' => $this->fare_computed_at?->toIso8601String(),
            // The counterpart of `WalkInFareEstimate::is_estimate`, and it
            // travels for the same reason: a client must not have to infer
            // which of the two figures it is holding from which key it
            // arrived under.
            'is_estimate' => false,
        ];
    }

    /**
     * What the trip is expected to fetch, before it is settled.
     *
     * The same quote `DispatchOfferResource` puts on the offer card, served
     * again here so the driver on the way to a pickup sees the figure they
     * accepted the job on — not a blank where a fare will eventually be.
     *
     * **Null unless `orderRequest` is loaded, and that is a deliberate
     * bound, not an oversight.** `WalkInFareService::quote()` costs two or
     * three queries through `RateCardResolver`, and `TripResource` also
     * renders list endpoints — a dispatch board of fifty trips would pay
     * fifty quotes for a figure nobody is reading there. So the controller
     * eager-loads the relation on `show` and not on `index`, and the field
     * follows. If a list ever genuinely needs it, the fix is to memoise the
     * tariff version per request inside Billing, not to drop this guard.
     *
     * Null too once the trip is settled: at that point `fare` holds the real
     * figure, and serving both would invite a screen to show an estimate
     * beside a bill.
     *
     * `RateCardNotConfiguredException` is caught rather than propagated for
     * the reason `DispatchOfferResource` gives — an unpriced category must
     * cost this trip a figure, not the whole request a 500. The loud failure
     * ADR-0026 wants belongs in `settle()`, where money changes hands.
     *
     * @return array<string, mixed>|null
     */
    private function estimatedFare(): ?array
    {
        if ($this->fare_minor !== null) {
            return null;
        }

        $order = $this->order();
        $category = $this->vehicle?->category;

        if ($order === null || ! is_string($category)) {
            return null;
        }

        try {
            return app(WalkInFareService::class)->quote(
                $category,
                $order->pickup_latitude,
                $order->pickup_longitude,
                $order->dropoff_latitude,
                $order->dropoff_longitude,
            )?->toArray();
        } catch (RateCardNotConfiguredException) {
            return null;
        }
    }
}
