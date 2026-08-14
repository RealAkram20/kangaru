<?php

use Illuminate\Support\Facades\Route;
use Modules\Trips\Controllers\LivePositionController;
use Modules\Trips\Controllers\OdometerPhotoController;
use Modules\Trips\Controllers\TripController;
use Modules\Trips\Controllers\TripEventController;
use Modules\Trips\Controllers\TripLocationController;
use Modules\Trips\Controllers\TripRouteController;

Route::apiResource('trips', TripController::class)->only(['index', 'show', 'store']);
Route::post('trips/{trip}/transitions', [TripController::class, 'transition'])->name('trips.transitions.store');
Route::get('trips/{trip}/events', [TripEventController::class, 'index'])->name('trips.events.index');
Route::get('trips/{trip}/route', [TripRouteController::class, 'show'])->name('trips.route.show');

// The dashboard photo captured with each odometer reading (PROJECT.md's
// anchor-client requirement). Streamed behind auth rather than served from
// a storage URL — see OdometerPhotoController.
Route::get('trips/{trip}/odometer-photo/{moment}', [OdometerPhotoController::class, 'show'])
    ->whereIn('moment', ['start', 'end'])
    ->name('trips.odometer-photo.show');

// ADR-0003 GPS ingestion and route replay. POST answers 202 rather than
// 201: the pings are validated and buffered, not yet written.
Route::post('trips/{trip}/locations', [TripLocationController::class, 'store'])->name('trips.locations.store');
Route::get('trips/{trip}/locations', [TripLocationController::class, 'index'])->name('trips.locations.index');

// Where the fleet is right now (ADR-0019). A collection of its own rather
// than a field on the trips listing: a live map polls this every few
// seconds and must not drag a page of trip rows along with it.
//
// No policy call — visibility is resolved by the trips query inside, which
// is the one place that predicate lives.
Route::get('live-positions', [LivePositionController::class, 'index'])->name('live-positions.index');
