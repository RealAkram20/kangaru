<?php

use Illuminate\Support\Facades\Route;
use Modules\Trips\Controllers\HeldTripController;
use Modules\Trips\Controllers\LivePositionController;
use Modules\Trips\Controllers\OdometerPhotoController;
use Modules\Trips\Controllers\TripController;
use Modules\Trips\Controllers\TripDistanceController;
use Modules\Trips\Controllers\TripDropoffArrivalController;
use Modules\Trips\Controllers\TripEventController;
use Modules\Trips\Controllers\TripExtensionController;
use Modules\Trips\Controllers\TripLocationController;
use Modules\Trips\Controllers\TripPlaceSuggestionController;
use Modules\Trips\Controllers\TripRouteController;
use Modules\Trips\Controllers\TripStopCandidateController;
use Modules\Trips\Controllers\TripStopController;

// ADR-0045: the distance review queue. **Before the resource**, or
// `trips/{trip}` swallows it and the queue becomes a lookup for a trip whose
// id is the string "distance-review".
Route::get('trips/distance-review', [HeldTripController::class, 'index'])->name('trips.distance-review.index');

Route::apiResource('trips', TripController::class)->only(['index', 'show', 'store']);
Route::post('trips/{trip}/transitions', [TripController::class, 'transition'])->name('trips.transitions.store');
Route::get('trips/{trip}/events', [TripEventController::class, 'index'])->name('trips.events.index');
Route::get('trips/{trip}/route', [TripRouteController::class, 'show'])->name('trips.route.show');

// ADR-0045: a driver extending a live run (§4), and the bounded search over
// the client's own place register that feeds it (§10). Stops are read back
// on the trip payload itself, so there is no index route to leak one.
Route::post('trips/{trip}/stops', [TripStopController::class, 'store'])->name('trips.stops.store');
Route::get('trips/{trip}/stop-candidates', [TripStopCandidateController::class, 'index'])->name('trips.stop-candidates.index');
// The §10 follow-up the owner decided on 2026-08-22: when the register has
// no answer, the server (never the handset) asks a public geocoder.
Route::get('trips/{trip}/place-suggestions', [TripPlaceSuggestionController::class, 'index'])->name('trips.place-suggestions.index');

// The passenger travelling past the drop-off they agreed to. Same table as
// stops, different act: an extension moves the end of the journey and the
// fare follows it, where a stop is a pause and is never billed.
//
// `dropoff-arrival` is the boundary the other three hang off — before it the
// driver's map points at the agreed destination, after it at the extensions.
// It is not a trip status: see TripDropoffArrivalController.
Route::post('trips/{trip}/dropoff-arrival', [TripDropoffArrivalController::class, 'store'])
    ->name('trips.dropoff-arrival.store');
Route::post('trips/{trip}/extensions', [TripExtensionController::class, 'store'])
    ->name('trips.extensions.store');
// The driver answering a passenger's request. `acceptance`/`decline` is the
// shape `me/offers/{offer}` already uses for the one other thing a driver
// answers, so the handset speaks one vocabulary for both.
Route::post('trips/{trip}/extensions/{extension}/acceptance', [TripExtensionController::class, 'accept'])
    ->name('trips.extensions.acceptance.store');
Route::post('trips/{trip}/extensions/{extension}/decline', [TripExtensionController::class, 'decline'])
    ->name('trips.extensions.decline.store');

// ADR-0045: the distance evidence behind a trip's billed figure, and the one
// act the review queue performs — lifting a hold, with a reason.
Route::get('trips/{trip}/distance', [TripDistanceController::class, 'index'])->name('trips.distance.index');
Route::post('trips/{trip}/distance/clearance', [TripDistanceController::class, 'clear'])->name('trips.distance.clear');

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
