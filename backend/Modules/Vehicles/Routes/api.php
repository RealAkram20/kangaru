<?php

use Illuminate\Support\Facades\Route;
use Modules\Vehicles\Controllers\VehicleCategoryController;
use Modules\Vehicles\Controllers\VehicleController;

// Registered before the vehicles resource so `vehicle-categories` cannot be
// swallowed by `vehicles/{vehicle}`. It would not be today — the segments
// differ — but the ordering costs nothing and the alternative is a 404 that
// takes an afternoon to explain.
//
// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
// `->parameters()` is not cosmetic here. A hyphenated resource name yields
// `{vehicle_category}`, which implicit binding cannot match against a
// `VehicleCategory $vehicleCategory` argument — the model would arrive
// unbound. The explicit PATCH below already spells it camelCase, so without
// this the two verbs would take different parameter names for one resource.
Route::apiResource('vehicle-categories', VehicleCategoryController::class)
    ->parameters(['vehicle-categories' => 'vehicleCategory'])
    ->except(['show', 'update']);
Route::patch('vehicle-categories/{vehicleCategory}', [VehicleCategoryController::class, 'update'])
    ->name('vehicle-categories.update');

// No `show`. Nine rows come back in one request and every consumer wants the
// whole vocabulary — a chooser cannot render one option.

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('vehicles', VehicleController::class)->except(['update']);
Route::patch('vehicles/{vehicle}', [VehicleController::class, 'update'])->name('vehicles.update');
