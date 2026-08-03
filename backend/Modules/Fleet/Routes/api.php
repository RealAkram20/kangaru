<?php

use Illuminate\Support\Facades\Route;
use Modules\Fleet\Controllers\VehicleAllocationController;

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
