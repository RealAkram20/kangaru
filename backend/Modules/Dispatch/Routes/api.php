<?php

use Illuminate\Support\Facades\Route;
use Modules\Dispatch\Controllers\DispatchController;

// The assignment is a resource of the booking, not a field on it: creating
// one produces a Trip (201), and POST is the only verb that makes sense for
// an act that can conflict.
Route::post('bookings/{booking}/assignment', [DispatchController::class, 'store'])
    ->name('bookings.assignment.store');
