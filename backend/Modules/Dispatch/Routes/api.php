<?php

use Illuminate\Support\Facades\Route;
use Modules\Dispatch\Controllers\DispatchController;
use Modules\Dispatch\Controllers\DriverOfferController;

// The assignment is a resource of the booking, not a field on it: creating
// one produces a Trip (201), and POST is the only verb that makes sense for
// an act that can conflict.
Route::post('bookings/{booking}/assignment', [DispatchController::class, 'store'])
    ->name('bookings.assignment.store');

// The pool ranked for this booking (ADR-0009). A sibling of the assignment
// rather than a filter on /vehicles: the ordering and the notes only mean
// anything relative to one booking's client and date, and hanging them off
// the fleet listing would imply the fleet has an owner.
Route::get('bookings/{booking}/candidate-vehicles', [DispatchController::class, 'candidates'])
    ->name('bookings.candidate-vehicles.index');

// The roster judged for this booking (ADR-0017). A sibling of the vehicle
// list for the same reason: "is this driver free" only has an answer
// relative to one booking's window.
Route::get('bookings/{booking}/candidate-drivers', [DispatchController::class, 'driverCandidates'])
    ->name('bookings.candidate-drivers.index');

// What the matcher would choose (ADR-0020). Always readable; committing it
// is the flag-gated sibling below.
Route::get('bookings/{booking}/recommendation', [DispatchController::class, 'recommendation'])
    ->name('bookings.recommendation.index');
Route::post('bookings/{booking}/auto-assignment', [DispatchController::class, 'autoAssign'])
    ->name('bookings.auto-assignment.store');

// The driver's side of automatic dispatch (ADR-0024 §3). `/me/`, like the
// duty and time-off routes, because the driver is the token and an id in the
// path is a thing to tamper with.
//
// This list is the source of truth, not the push notification. ADR-0025 §3
// makes push best-effort — a driver can refuse the permission, a token can
// go stale, and ADR-0023's whole thesis is dead zones — so everything a push
// says must be independently readable here.
Route::get('me/offers', [DriverOfferController::class, 'index'])->name('me.offers.index');

// Plain integers, not bound models: the controller scopes the lookup to the
// caller's own driver profile, so another driver's offer id answers 404
// rather than resolving and needing a policy to refuse it with a 403 that
// confirms it exists.
//
// `acceptance` and `decline` as sub-resources rather than a PATCH with a
// status field: an accept is an act that can conflict and that creates a
// Trip, which is the same reasoning `bookings/{booking}/assignment` records
// for being a POST.
Route::post('me/offers/{offer}/acceptance', [DriverOfferController::class, 'accept'])
    ->whereNumber('offer')
    ->name('me.offers.acceptance.store');
Route::post('me/offers/{offer}/decline', [DriverOfferController::class, 'decline'])
    ->whereNumber('offer')
    ->name('me.offers.decline.store');
