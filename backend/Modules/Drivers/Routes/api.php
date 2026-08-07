<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverAccountController;
use Modules\Drivers\Controllers\DriverController;

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('drivers', DriverController::class)->except(['update']);
Route::patch('drivers/{driver}', [DriverController::class, 'update'])->name('drivers.update');

// The login a driver signs in with (ADR-0016). Singular, because a driver
// has one or none — `POST` attaches, `DELETE` takes it away.
Route::post('drivers/{driver}/account', [DriverAccountController::class, 'store'])
    ->name('drivers.account.store');
Route::delete('drivers/{driver}/account', [DriverAccountController::class, 'destroy'])
    ->name('drivers.account.destroy');
