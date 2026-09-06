<?php

use Illuminate\Support\Facades\Route;
use Modules\Bookings\Controllers\PublicFareQuoteController;
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

// Named limiter, not a literal: the number lives in platform settings
// (ordering.rate_limit_per_minute, default 3) per ADR-0012's own
// consequence — "the number moves by config, not by removing the
// throttle". AppServiceProvider::boot defines it.
Route::middleware('throttle:public-orders')->group(function () {
    Route::post('public/order-requests', [PublicOrderRequestController::class, 'store'])
        ->name('public.order-requests.store');
});

// The one public GET, and it is not the status checker the ADR refused: it
// answers "what would this cost" from coordinates alone, keyed by nothing a
// customer owns, and returns only the public tariff's arithmetic. 30/min/IP,
// the same allowance as `/public/legal` — a form that re-quotes on every
// keystroke would be the client's bug, not a reason to widen this.
Route::get('public/fare-quotes', [PublicFareQuoteController::class, 'index'])
    ->middleware('throttle:30,1')
    ->name('public.fare-quotes.index');
