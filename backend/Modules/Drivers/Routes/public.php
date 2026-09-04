<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\ApplicationDocumentController;
use Modules\Drivers\Controllers\DriverApplicationController;

/*
|--------------------------------------------------------------------------
| Public routes (no authentication)
|--------------------------------------------------------------------------
|
| ADR-0027. Kept in a separate file from the module's authenticated routes
| so the difference is impossible to miss in review: everything in here is
| reachable by anyone on the internet, and each route must carry its own
| throttle.
|
| 5/min/IP — the auth-endpoint rate from AGENTS.md, which is the right
| comparison: this endpoint takes an email and a password and is the only
| unauthenticated write in the Drivers module.
|
| An applicant still cannot read their own application (ADR-0027 §6) —
| answering "what is the status of the application for this address" to an
| unauthenticated caller is the same enumeration oracle the POST is careful
| not to be.
|
| The GET added below is **not** that. It takes an opaque 64-character secret
| minted at submission, never an email address, and it answers with which of
| the six document slots the holder has filled — not with a status, not with a
| decision, and never with file bytes (ADR-0048 §4). An unknown, expired or
| already-decided ticket gets the same 404 as a made-up one.
|
*/

Route::middleware('throttle:5,1')->group(function () {
    Route::post('driver-applications', [DriverApplicationController::class, 'store'])
        ->name('public.driver-applications.store');

    /*
     * The KYC screen's three verbs (ADR-0048 §4).
     *
     * Under `driver-applications/documents` with **no `{application}`
     * segment**, and that absence is the security property: there is no id in
     * the URL to change. The row is whichever one the claim ticket resolves
     * to, so a caller cannot ask about an application other than their own
     * even by accident.
     *
     * Sharing the 5/min/IP throttle above rather than taking a looser one of
     * their own: this is an unauthenticated write of an 8 MB file onto the
     * operator's disk, which is the most expensive thing in this file.
     */
    Route::get('driver-applications/documents', [ApplicationDocumentController::class, 'index'])
        ->name('public.driver-applications.documents.index');
    Route::post('driver-applications/documents', [ApplicationDocumentController::class, 'store'])
        ->name('public.driver-applications.documents.store');
    Route::delete('driver-applications/documents/{type}', [ApplicationDocumentController::class, 'destroy'])
        ->name('public.driver-applications.documents.destroy');
});
