<?php

use Illuminate\Support\Facades\Route;
use Modules\Administration\Controllers\AuditLogController;
use Modules\Administration\Controllers\AuthController;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::post('/auth/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
Route::get('/auth/me', [AuthController::class, 'me'])->middleware('auth:sanctum');

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('/audit-logs', [AuditLogController::class, 'index']);
});
