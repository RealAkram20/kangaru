<?php

use Illuminate\Support\Facades\Route;
use Modules\Notifications\Controllers\DeviceTokenController;
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

// Where to push a notification (ADR-0025 §4). `/me/`, like the driver app's
// other routes: the account is the token and there is no id to tamper with.
//
// Registered on every sign-in and every OS token rotation, so `store` is
// idempotent by the token's unique index rather than by the caller being
// careful.
Route::post('me/devices', [DeviceTokenController::class, 'store'])
    ->name('me.devices.store');

// The token in the path rather than the body, because DELETE has no body in
// any HTTP client worth relying on. `whereNotIn` nothing — a token is opaque,
// and constraining its shape here would break the day a second provider
// arrives (see StoreDeviceTokenRequest).
Route::delete('me/devices/{token}', [DeviceTokenController::class, 'destroy'])
    ->name('me.devices.destroy');
