<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverApplicationController;

/*
|--------------------------------------------------------------------------
| Public routes (no authentication)
|--------------------------------------------------------------------------
|
| ADR-0027. Kept in a separate file from the module's authenticated routes
| so the difference is impossible to miss in review: everything in here is
| reachable by anyone on the internet, and each route must carry its own
| throttle.
|
| 5/min/IP — the auth-endpoint rate from AGENTS.md, which is the right
| comparison: this endpoint takes an email and a password and is the only
| unauthenticated write in the Drivers module.
|
| There is deliberately no public GET. An applicant cannot read their own
| application (ADR-0027 §6) — answering "what is the status of the
| application for this address" to an unauthenticated caller is the same
| enumeration oracle the POST is careful not to be.
|
*/

Route::middleware('throttle:5,1')->group(function () {
    Route::post('driver-applications', [DriverApplicationController::class, 'store'])
        ->name('public.driver-applications.store');
});
