<?php

use Illuminate\Support\Facades\Route;
use Modules\Notifications\Controllers\NotificationController;

// Always the authenticated user's own inbox — there is no
// /notifications/{user} and no way to ask for anybody else's. The route
// takes no user parameter precisely so that none can be supplied.
Route::get('notifications', [NotificationController::class, 'index'])
    ->name('notifications.index');

// A plain integer, not a bound model: NotificationController scopes the
// lookup to the recipient, so another user's id answers 404 rather than
// letting route-model binding resolve it and a policy refuse it with a 403
// that confirms it exists.
Route::patch('notifications/{notification}', [NotificationController::class, 'markRead'])
    ->whereNumber('notification')
    ->name('notifications.read');

// PATCH on the collection: it modifies every member rather than creating
// anything, so neither POST nor a verb in the path is right.
Route::patch('notifications', [NotificationController::class, 'markAllRead'])
    ->name('notifications.read-all');
