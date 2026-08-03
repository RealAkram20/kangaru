<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverController;

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('drivers', DriverController::class)->except(['update']);
Route::patch('drivers/{driver}', [DriverController::class, 'update'])->name('drivers.update');
