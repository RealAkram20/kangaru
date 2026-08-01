<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverController;

Route::apiResource('drivers', DriverController::class);
