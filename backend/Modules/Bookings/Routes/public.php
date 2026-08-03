<?php

use Illuminate\Support\Facades\Route;
use Modules\Bookings\Controllers\PublicOrderRequestController;

/*
|--------------------------------------------------------------------------
| Public routes (no authentication)
|--------------------------------------------------------------------------
|
| ADR-0012 §3. Kept in a separate file from the module's authenticated
| routes so the difference is impossible to miss in review: everything in
| here is reachable by anyone on the internet, and each route must carry
| its own throttle.
|
| 3/min/IP — stricter than auth's 5. There is deliberately no public GET:
| a status checker keyed by a guessable reference is an enumeration
| surface (see the ADR).
|
*/

Route::middleware('throttle:3,1')->group(function () {
    Route::post('public/order-requests', [PublicOrderRequestController::class, 'store'])
        ->name('public.order-requests.store');
});
