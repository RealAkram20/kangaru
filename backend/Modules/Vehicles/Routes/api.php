<?php

use Illuminate\Support\Facades\Route;
use Modules\Vehicles\Controllers\VehicleController;

Route::apiResource('vehicles', VehicleController::class);
