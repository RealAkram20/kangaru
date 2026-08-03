<?php

use Illuminate\Support\Facades\Route;
use Modules\Vehicles\Controllers\VehicleController;

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('vehicles', VehicleController::class)->except(['update']);
Route::patch('vehicles/{vehicle}', [VehicleController::class, 'update'])->name('vehicles.update');
