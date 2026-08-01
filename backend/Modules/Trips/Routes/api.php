<?php

use Illuminate\Support\Facades\Route;
use Modules\Trips\Controllers\TripController;
use Modules\Trips\Controllers\TripEventController;

Route::apiResource('trips', TripController::class)->only(['index', 'show', 'store']);
Route::post('trips/{trip}/transitions', [TripController::class, 'transition'])->name('trips.transitions.store');
Route::get('trips/{trip}/events', [TripEventController::class, 'index'])->name('trips.events.index');
