<?php

use Illuminate\Support\Facades\Route;
use Modules\Dispatch\Controllers\DispatchController;

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
