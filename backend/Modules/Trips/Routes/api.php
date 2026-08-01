<?php

use Illuminate\Support\Facades\Route;
use Modules\Trips\Controllers\TripController;
use Modules\Trips\Controllers\TripEventController;
use Modules\Trips\Controllers\TripLocationController;

Route::apiResource('trips', TripController::class)->only(['index', 'show', 'store']);
Route::post('trips/{trip}/transitions', [TripController::class, 'transition'])->name('trips.transitions.store');
Route::get('trips/{trip}/events', [TripEventController::class, 'index'])->name('trips.events.index');

// ADR-0003 GPS ingestion and route replay. POST answers 202 rather than
// 201: the pings are validated and buffered, not yet written.
Route::post('trips/{trip}/locations', [TripLocationController::class, 'store'])->name('trips.locations.store');
Route::get('trips/{trip}/locations', [TripLocationController::class, 'index'])->name('trips.locations.index');
