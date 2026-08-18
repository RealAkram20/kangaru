<?php

use Illuminate\Support\Facades\Route;
use Modules\Support\Controllers\DriverSupportRequestController;
use Modules\Support\Controllers\SupportRequestController;

/*
 * Driver issue reporting (ADR-0044).
 *
 * Required from `routes/api.php` inside the `auth:sanctum` + tenant group, like
 * every other module here. Both halves live in one file because they are one
 * feature: a driver writes, the office answers, and separating the halves is
 * how the second one comes to be skipped.
 */

// The driver's own reports. Under `/me`, so the driver is the token and there
// is no id to authorise against — the controller checks only that the account
// has a driver profile.
//
// **No `DELETE`.** A driver cannot withdraw a report the way ADR-0043 lets them
// withdraw a closure request: that is an ask about a future state and this is an
// account of something that already happened. A report the office has read and
// acted on cannot be unsaid, and one they have not read yet is answered by
// writing again rather than by deleting the record.
Route::get('me/support-requests', [DriverSupportRequestController::class, 'index'])
    ->name('me.support-requests.index');
Route::post('me/support-requests', [DriverSupportRequestController::class, 'store'])
    ->name('me.support-requests.store');

// The office queue. `drivers.manage` through `SupportRequestPolicy`, which
// records why that permission and where the seam is when Support separates from
// Fleet.
//
// Answering is a POST to a sub-path rather than a PATCH on a status field — the
// shape every other office decision here uses, because a decision has its own
// audit meaning and a status field would make it look like an edit.
Route::get('support-requests', [SupportRequestController::class, 'index'])
    ->name('support-requests.index');
Route::get('support-requests/{supportRequest}', [SupportRequestController::class, 'show'])
    ->name('support-requests.show');
Route::post('support-requests/{supportRequest}/answer', [SupportRequestController::class, 'answer'])
    ->name('support-requests.answer');
