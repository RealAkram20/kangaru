<?php

namespace Modules\Customers\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Bookings\Models\OrderRequest;
use Modules\Customers\Resources\CustomerRideResource;
use Modules\Trips\Models\Trip;

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

        $ride = OrderRequest::query()
            ->where('customer_id', $customer->id)
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
        if ($trip !== null && ! $trip->status->occupiesVehicle()) {
            return ApiResponse::success(null, 'No ride in progress.');
        }

        // Set explicitly so the resource reads the trip resolved below
        // rather than triggering `$ride->trip`, which would go through the
        // tenant scope and come back null. See `tripFor()`.
        $ride->setRelation('trip', $trip);

        return ApiResponse::success(new CustomerRideResource($ride), 'Your ride.');
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
