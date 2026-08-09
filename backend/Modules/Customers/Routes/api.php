<?php

use Illuminate\Support\Facades\Route;
use Modules\Customers\Controllers\CustomerAuthController;
use Modules\Customers\Controllers\CustomerOrderRequestController;
use Modules\Customers\Controllers\CustomerRideController;

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

    Route::middleware('auth:customer')->group(function () {
        Route::post('/auth/logout', [CustomerAuthController::class, 'logout'])
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
    });
});
