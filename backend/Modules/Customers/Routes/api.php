<?php

use Illuminate\Support\Facades\Route;
use Modules\Customers\Controllers\CustomerAuthController;
use Modules\Customers\Controllers\CustomerOrderRequestController;
use Modules\Customers\Controllers\CustomerRideController;
use Modules\Trips\Controllers\TripRatingController;

/*
|--------------------------------------------------------------------------
| Customer routes (ADR-0013)
|--------------------------------------------------------------------------
|
| The second principal's surface, all under /customer so the split from
| the staff API is visible in every URL. Nothing here touches `tenant`
| or `subject-tenant` middleware — a customer has no tenant, and every
| read is scoped to the token's own customer, not to a context.
|
| Same throttles as staff auth (5/min/IP): the register endpoint is an
| unauthenticated write and the login endpoint is a guessing surface,
| exactly like their staff counterparts.
|
*/

Route::prefix('customer')->group(function () {
    Route::post('/auth/register', [CustomerAuthController::class, 'register'])
        ->middleware('throttle:5,1')
        ->name('customer.auth.register');
    Route::post('/auth/login', [CustomerAuthController::class, 'login'])
        ->middleware('throttle:5,1')
        ->name('customer.auth.login');

    // `walk-in-or-support`, not `auth:customer` (ADR-0066 section 3). The
    // walk-in's own token answers first and almost always; a staff token is
    // accepted only while a live acting-as session names this customer as its
    // subject, and is refused with a plain 401 otherwise. Stacking a second
    // middleware after `auth:customer` could not have expressed it - the first
    // would have rejected the staff token before the second ever ran.
    Route::middleware('walk-in-or-support')->group(function () {
        // Denied while acting as (ADR-0066 section 4), and the reason is
        // mechanical rather than moral: this revokes `currentAccessToken()`,
        // which under a session is the support agent's own staff token. A
        // support agent pressing sign-out here would sign themselves out of
        // the console and revoke the credential the session runs on.
        Route::post('/auth/logout', [CustomerAuthController::class, 'logout'])
            ->middleware('not-acting-as')
            ->name('customer.auth.logout');
        Route::get('/auth/me', [CustomerAuthController::class, 'me'])
            ->name('customer.auth.me');

        // The status checker ADR-0012 deferred, delivered the safe way
        // (ADR-0013 §4): scoped by the token, so there is no reference to
        // enumerate and no id resolvable outside your own rows.
        Route::get('/order-requests', [CustomerOrderRequestController::class, 'index'])
            ->name('customer.order-requests.index');
        Route::get('/order-requests/{orderRequest}', [CustomerOrderRequestController::class, 'show'])
            ->name('customer.order-requests.show');

        // The ride screen's live feed (ADR-0024 §7) — what replaces
        // `simulatedRideSource` in the public order flow.
        //
        // Takes no identifier at all, deliberately. The screen holds a
        // `KR-` reference and not an id, because ADR-0012 gave the public
        // order endpoint nothing enumerable to return; keying this by the
        // reference would reintroduce exactly the guessable lookup that ADR
        // rejected. The customer asks for their own current ride, and there
        // is nothing in the request to tamper with.
        Route::get('/rides/active', [CustomerRideController::class, 'active'])
            ->name('customer.rides.active');

        // Calling the ride off (ADR-0024 §7). Same reasoning as the read
        // above: no identifier, because the ride is whichever one is active
        // for this token and there is nothing in the request to tamper with.
        //
        // A nested resource under `active` rather than `DELETE /rides/active`
        // — cancelling creates a cancellation, it does not delete the ride,
        // and the trip and the order both survive it with a status and a
        // reason on them. Matches how `/me/offers/{id}/acceptance` names the
        // driver's side of the same idea.
        Route::post('/rides/active/cancellation', [CustomerRideController::class, 'cancel'])
            ->name('customer.rides.cancel');

        // Asking to be taken further than the drop-off agreed at booking.
        // Nested under `active` for the same reason cancellation is: the ride
        // is whichever one is running, and the passenger supplies no id to
        // tamper with.
        //
        // A **request**, not a change — the driver answers it through
        // `trips/{trip}/extensions/{extension}/acceptance`. Until they do it
        // is `PROPOSED`, which nothing routes through and nothing bills.
        Route::post('/rides/active/extension', [CustomerRideController::class, 'extend'])
            ->name('customer.rides.extension.store');

        // Rating the ride once it is over (ADR-0030 §1). Keyed by trip id
        // unlike the endpoints above, and safely: the controller refuses any
        // trip whose customer_id is not this token's, so an id guessed from
        // elsewhere resolves to a 404 rather than somebody else's journey.
        Route::post('/trips/{trip}/rating', [TripRatingController::class, 'store'])
            ->name('customer.trips.rating.store');
    });
});
