<?php

use Illuminate\Support\Facades\Route;
use Modules\Administration\Controllers\AuditLogController;
use Modules\Administration\Controllers\AuthController;
use Modules\Administration\Controllers\PublicSettingsController;
use Modules\Administration\Controllers\RoleController;
use Modules\Administration\Controllers\SettingsController;
use Modules\Administration\Controllers\UserController;

// The branding subset, unauthenticated (ADR-0014 §5): the landing page,
// login screen and document head read their identity from here. Only
// catalogue keys flagged `public` can appear; throttled like any public
// read.
Route::get('/public/settings', [PublicSettingsController::class, 'index'])
    ->middleware('throttle:30,1')
    ->name('public.settings');

Route::post('/auth/login', [AuthController::class, 'login'])
    ->middleware('throttle:5,1')
    ->name('auth.login');
Route::post('/auth/logout', [AuthController::class, 'logout'])
    ->middleware('auth:sanctum')
    ->name('auth.logout');
Route::get('/auth/me', [AuthController::class, 'me'])
    ->middleware('auth:sanctum')
    ->name('auth.me');

// Changing your own password needs authentication but not a tenant: a
// Super Admin has none, and every other route below would 404 for them.
Route::patch('/auth/password', [AuthController::class, 'changePassword'])
    ->middleware(['auth:sanctum', 'throttle:5,1'])
    ->name('auth.password.change');

/*
|--------------------------------------------------------------------------
| Multi-factor authentication (ADR-0008)
|--------------------------------------------------------------------------
|
| These route *names* are load-bearing: `EnsureMfaEnrolled` allows a user
| who must enrol to reach the enrolment pair and nothing else, and it
| matches on name rather than path. A path prefix would have opened
| `auth/mfa/verify` too, which belongs to the other half of the flow and is
| reached with no token at all.
|
*/

// Unauthenticated, deliberately: the caller has proved a password and holds
// a challenge, which is exactly the state in which no token exists.
//
// Throttled harder than login. The login limit is 5/min/IP, which does
// nothing against a distributed attempt on one known Finance account — but
// a challenge is single-use, so the real bound on guessing six digits is
// that each attempt costs a fresh password authentication.
Route::post('/auth/mfa/verify', [AuthController::class, 'verifyMfa'])
    ->middleware('throttle:10,1')
    ->name('auth.mfa.verify');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/mfa/enrol', [AuthController::class, 'beginMfaEnrolment'])
        ->name('auth.mfa.enrol');
    Route::post('/auth/mfa/enrol/confirm', [AuthController::class, 'confirmMfaEnrolment'])
        ->middleware('throttle:10,1')
        ->name('auth.mfa.enrol.confirm');

    // Not on the forced-enrolment allowlist: you cannot regenerate codes
    // you do not have yet, and the enrolment response is where the first
    // set comes from.
    Route::post('/auth/mfa/recovery-codes', [AuthController::class, 'regenerateRecoveryCodes'])
        ->middleware('throttle:5,1')
        ->name('auth.mfa.recovery-codes');

    // ADR-0010 decision 2: voluntary means voluntary in both directions.
    //
    // Also not on the forced-enrolment allowlist, and that is the point: a
    // user who *must* enrol cannot reach this to avoid enrolling, and a user
    // whose role requires a factor is refused by the controller even if they
    // can reach it. Throttled like the other code-proving routes — it takes
    // a current code, so it is a guessing surface.
    Route::delete('/auth/mfa', [AuthController::class, 'disableMfa'])
        ->middleware('throttle:10,1')
        ->name('auth.mfa.disable');
});

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('/audit-logs', [AuditLogController::class, 'index']);

    // Staff administration. Until these existed every account came from a
    // seeder — there was no way to onboard a colleague or revoke access.
    //
    // No DELETE: accounts are suspended, never removed. A user who has
    // raised a booking or issued an invoice is referenced by rows that must
    // outlive them, and `invoices.issued_by_user_id` is restrictOnDelete,
    // so the database refuses it anyway.
    Route::get('/users', [UserController::class, 'index'])->name('users.index');
    Route::post('/users', [UserController::class, 'store'])->name('users.store');
    Route::get('/users/{user}', [UserController::class, 'show'])->name('users.show');
    Route::patch('/users/{user}', [UserController::class, 'update'])->name('users.update');

    // Platform settings (ADR-0014), behind `settings.manage` via
    // SettingPolicy. PATCH takes the group name so each save is one
    // audited, validated write of related keys.
    Route::get('/settings', [SettingsController::class, 'index'])->name('settings.index');
    Route::patch('/settings/{group}', [SettingsController::class, 'update'])->name('settings.update');
    Route::post('/settings/assets/{asset}', [SettingsController::class, 'uploadAsset'])
        ->name('settings.assets.upload');
    // Throttled: each call opens a real SMTP connection to whatever host
    // is stored, which must not become an outbound-probe primitive.
    Route::post('/settings/mail/test', [SettingsController::class, 'sendTestMail'])
        ->middleware('throttle:5,1')
        ->name('settings.mail.test');

    // The role catalogue (ADR-0004). Platform-wide and curated by whoever
    // holds `roles.manage` — Super Admin alone, as seeded. Route key is the
    // slug, which is what `users.role` stores.
    Route::get('/roles', [RoleController::class, 'index'])->name('roles.index');
    Route::post('/roles', [RoleController::class, 'store'])->name('roles.store');
    Route::patch('/roles/{role}', [RoleController::class, 'update'])->name('roles.update');
    Route::delete('/roles/{role}', [RoleController::class, 'destroy'])->name('roles.destroy');
});
