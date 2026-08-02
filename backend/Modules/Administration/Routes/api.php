<?php

use Illuminate\Support\Facades\Route;
use Modules\Administration\Controllers\AuditLogController;
use Modules\Administration\Controllers\AuthController;
use Modules\Administration\Controllers\UserController;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::post('/auth/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
Route::get('/auth/me', [AuthController::class, 'me'])->middleware('auth:sanctum');

// Changing your own password needs authentication but not a tenant: a
// Super Admin has none, and every other route below would 404 for them.
Route::patch('/auth/password', [AuthController::class, 'changePassword'])
    ->middleware(['auth:sanctum', 'throttle:5,1']);

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
});
