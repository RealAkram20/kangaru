<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverAccountController;
use Modules\Drivers\Controllers\DriverApplicationController;
use Modules\Drivers\Controllers\DriverController;
use Modules\Drivers\Controllers\DriverStatsController;

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('drivers', DriverController::class)->except(['update']);
Route::patch('drivers/{driver}', [DriverController::class, 'update'])->name('drivers.update');

// The login a driver signs in with (ADR-0016). Singular, because a driver
// has one or none — `POST` attaches, `DELETE` takes it away.
Route::post('drivers/{driver}/account', [DriverAccountController::class, 'store'])
    ->name('drivers.account.store');
Route::delete('drivers/{driver}/account', [DriverAccountController::class, 'destroy'])
    ->name('drivers.account.destroy');

// The driver's own numbers, for their home screen. Under `/me` like offers
// and duty: the driver is the token, so there is no id and no policy left.
Route::get('me/stats', [DriverStatsController::class, 'show'])->name('me.stats.show');

// The applications queue (ADR-0027). The submission half is public and
// lives in this module's public.php — these are the console side.
//
// Approve and reject are POSTs to sub-paths rather than a PATCH on a status
// field, for the reason ADR-0016 gives for the account sub-resource: they
// are decisions with their own permission and their own audit meaning, and
// approving in particular creates a driver, creates a user and links them.
// A status field would make all that look like an edit.
Route::get('driver-applications', [DriverApplicationController::class, 'index'])
    ->name('driver-applications.index');
Route::get('driver-applications/{driverApplication}', [DriverApplicationController::class, 'show'])
    ->name('driver-applications.show');
Route::post('driver-applications/{driverApplication}/approve', [DriverApplicationController::class, 'approve'])
    ->name('driver-applications.approve');
Route::post('driver-applications/{driverApplication}/reject', [DriverApplicationController::class, 'reject'])
    ->name('driver-applications.reject');
