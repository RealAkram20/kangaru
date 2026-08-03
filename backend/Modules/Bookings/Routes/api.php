<?php

use Illuminate\Support\Facades\Route;
use Modules\Bookings\Controllers\BookingController;
use Modules\Bookings\Controllers\OrderRequestController;

Route::apiResource('bookings', BookingController::class)->only(['index', 'show', 'store']);

// Decisions are POSTed as named sub-resources rather than PATCHing `status`
// directly: each carries its own policy and its own required payload, and a
// raw status write would bypass BookingService's transition check.
Route::post('bookings/{booking}/approval', [BookingController::class, 'approve'])->name('bookings.approve');
Route::post('bookings/{booking}/rejection', [BookingController::class, 'reject'])->name('bookings.reject');
Route::post('bookings/{booking}/cancellation', [BookingController::class, 'cancel'])->name('bookings.cancel');

// The walk-in queue (ADR-0012 §4). Update is a PATCH of `status` through
// OrderRequestService's transition map rather than named sub-resources:
// unlike a booking's approve/reject, every move here carries the same
// payload shape and the same policy, so one route tells the truth.
Route::get('order-requests', [OrderRequestController::class, 'index'])->name('order-requests.index');
Route::get('order-requests/{orderRequest}', [OrderRequestController::class, 'show'])->name('order-requests.show');
Route::patch('order-requests/{orderRequest}', [OrderRequestController::class, 'update'])->name('order-requests.update');
