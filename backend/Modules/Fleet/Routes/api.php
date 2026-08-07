<?php

use Illuminate\Support\Facades\Route;
use Modules\Fleet\Controllers\AvailabilityBlockController;
use Modules\Fleet\Controllers\DriverAvailabilityController;
use Modules\Fleet\Controllers\VehicleAllocationController;
use Modules\Fleet\Controllers\ZoneController;

// `Modules/Fleet`'s first routes (ADR-0009). Nested under nothing: an
// allocation is about one vehicle and one client but belongs to neither
// listing, and platform staff read it across every client.
Route::get('allocations', [VehicleAllocationController::class, 'index'])->name('allocations.index');
Route::post('allocations', [VehicleAllocationController::class, 'store'])->name('allocations.store');
Route::get('allocations/{allocation}', [VehicleAllocationController::class, 'show'])->name('allocations.show');

// Ending is the only mutation offered. Moving a contract's start after the
// fact would rewrite which days a client was owed a vehicle, and the trips
// dispatched under it would stop being explicable — see
// EndVehicleAllocationRequest.
Route::patch('allocations/{allocation}', [VehicleAllocationController::class, 'end'])->name('allocations.end');

// Availability — who and what is off the road, and when (ADR-0017).
//
// A flat collection rather than sub-resources under drivers and vehicles:
// "what is out this week" crosses both, and two endpoints would have to be
// merged by every caller that asked it.
Route::get('availability-blocks', [AvailabilityBlockController::class, 'index'])
    ->name('availability-blocks.index');
Route::post('availability-blocks', [AvailabilityBlockController::class, 'store'])
    ->name('availability-blocks.store');
// Where the fleet office answers a driver's request for time off — the far
// end of the Driver's Application (Phase 2).
Route::post('availability-blocks/{availabilityBlock}/answer', [AvailabilityBlockController::class, 'answer'])
    ->name('availability-blocks.answer');
Route::delete('availability-blocks/{availabilityBlock}', [AvailabilityBlockController::class, 'destroy'])
    ->name('availability-blocks.destroy');

// Geofences (ADR-0021). `resolve` is declared before the `{zone}` routes so
// the literal segment is not swallowed by the parameter.
Route::get('zones', [ZoneController::class, 'index'])->name('zones.index');
Route::get('zones/resolve', [ZoneController::class, 'resolve'])->name('zones.resolve');
Route::post('zones', [ZoneController::class, 'store'])->name('zones.store');
Route::patch('zones/{zone}', [ZoneController::class, 'update'])->name('zones.update');
Route::delete('zones/{zone}', [ZoneController::class, 'destroy'])->name('zones.destroy');

// A driver asking for their own time off — the Driver's Application's half
// of ADR-0017 §6. `/me/` rather than `/drivers/{id}/`: an id in the path is
// a thing to tamper with, and these routes take no `resource_id` at all.
//
// Throttled: a request is a human act a few times a month, and the mobile
// client retrying a failed submit must not be able to fill the office's
// queue with duplicates.
Route::get('me/availability-requests', [DriverAvailabilityController::class, 'index'])
    ->name('me.availability-requests.index');
Route::post('me/availability-requests', [DriverAvailabilityController::class, 'store'])
    ->middleware('throttle:10,1')
    ->name('me.availability-requests.store');
Route::delete('me/availability-requests/{availabilityBlock}', [DriverAvailabilityController::class, 'destroy'])
    ->name('me.availability-requests.destroy');
