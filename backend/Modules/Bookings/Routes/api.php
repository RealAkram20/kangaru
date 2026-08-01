<?php

use Illuminate\Support\Facades\Route;
use Modules\Bookings\Controllers\BookingController;

Route::apiResource('bookings', BookingController::class)->only(['index', 'show', 'store']);

// Decisions are POSTed as named sub-resources rather than PATCHing `status`
// directly: each carries its own policy and its own required payload, and a
// raw status write would bypass BookingService's transition check.
Route::post('bookings/{booking}/approval', [BookingController::class, 'approve'])->name('bookings.approve');
Route::post('bookings/{booking}/rejection', [BookingController::class, 'reject'])->name('bookings.reject');
Route::post('bookings/{booking}/cancellation', [BookingController::class, 'cancel'])->name('bookings.cancel');
