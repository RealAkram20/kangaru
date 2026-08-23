<?php

use Illuminate\Support\Facades\Route;
use Modules\Notifications\Controllers\DeviceTokenController;
use Modules\Notifications\Controllers\MailToggleController;
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

// Which emails this deployment sends at all (mail plan M3, the owner's ask).
//
// `settings/email` rather than `notifications/toggles`: it is a platform
// setting and it sits with the others in the settings screen. Gated by
// `SettingPolicy`, which ADR-0014 §4 already holds at `settings.manage` for
// both directions, so this is Super Admin and nobody else. Reading the list
// tells you which warnings this platform does not send, which is why the read
// is held as tightly as the write.
Route::get('settings/email', [MailToggleController::class, 'index'])
    ->name('settings.email.index');

// PUT rather than PATCH, and one switch per call. The body names the type and
// the state it should be in, which is idempotent: sending "off" twice leaves
// it off rather than toggling it back on.
Route::put('settings/email', [MailToggleController::class, 'update'])
    ->name('settings.email.update');
