<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\DriverAccountController;
use Modules\Drivers\Controllers\DriverApplicationController;
use Modules\Drivers\Controllers\DriverController;
use Modules\Drivers\Controllers\DriverDocumentController;
use Modules\Drivers\Controllers\DriverDocumentReviewController;
use Modules\Drivers\Controllers\DriverEarningsController;
use Modules\Drivers\Controllers\DriverLedgerController;
use Modules\Drivers\Controllers\DriverProfileController;
use Modules\Drivers\Controllers\DriverSettlementRequestController;
use Modules\Drivers\Controllers\DriverStatsController;
use Modules\Drivers\Controllers\DriverTripHistoryController;
use Modules\Drivers\Controllers\SettlementRequestController;

// PATCH only, not PUT|PATCH — see Modules/Clients/Routes/api.php.
Route::apiResource('drivers', DriverController::class)->except(['update']);
Route::patch('drivers/{driver}', [DriverController::class, 'update'])->name('drivers.update');

// The login a driver signs in with (ADR-0016). Singular, because a driver
// has one or none — `POST` attaches, `DELETE` takes it away.
Route::post('drivers/{driver}/account', [DriverAccountController::class, 'store'])
    ->name('drivers.account.store');
Route::delete('drivers/{driver}/account', [DriverAccountController::class, 'destroy'])
    ->name('drivers.account.destroy');

// The driver's own numbers, for their home screen. Under `/me` like offers
// and duty: the driver is the token, so there is no id and no policy left.
Route::get('me/stats', [DriverStatsController::class, 'show'])->name('me.stats.show');

// Who they are on the platform — the Profile screen. Separate from
// `me/stats` for the reason `me/earnings` is: stats is polled every sixty
// seconds on the home screen, and a lifetime trip count, a vehicle join and a
// documents summary should not ride along on every poll.
Route::get('me/profile', [DriverProfileController::class, 'show'])->name('me.profile.show');

// Their papers (ADR-0033). `index` returns **every type, held or not** — a
// driver opening the screen is asking what they still owe the office, and only
// the full set answers that.
//
// `store` is deliberately outside the offline outbox (ADR-0023): that queue
// carries small JSON transitions, and an eight-megabyte photograph is a
// different problem. The upload needs a connection and the screen says so.
Route::get('me/documents', [DriverDocumentController::class, 'index'])
    ->name('me.documents.index');
Route::post('me/documents', [DriverDocumentController::class, 'store'])
    ->name('me.documents.store');
// Streamed through the API, never a storage URL: a signed link to somebody's
// identity document is addressable by anyone who ever saw it. The one method
// on `/me` that takes an id, and therefore the one with a policy check.
Route::get('me/documents/{document}/file', [DriverDocumentController::class, 'file'])
    ->name('me.documents.file');

// The same driver's earnings over a day, a week or a month — the earnings
// screen. Separate from `me/stats` rather than a fatter payload on it: stats
// is polled on the home screen and answers "how am I doing", while this is
// opened deliberately, takes a period parameter, and carries a chart series.
// Folding them together would make every home-screen poll pay for a trend
// nobody is looking at.
Route::get('me/earnings', [DriverEarningsController::class, 'show'])->name('me.earnings.show');

// The ledger itself, row by row — the wallet statement. Cursor-paginated
// like the trip timeline it resembles: both are append-only and both are read
// newest-first, which is what AGENTS.md means by an append-heavy list.
//
// Read-only by design. ADR-0029 §6 keeps the platform recording money rather
// than moving it, so there is no counterpart POST and a driver cannot write a
// settlement — those belong to the office.
Route::get('me/ledger-entries', [DriverLedgerController::class, 'index'])
    ->name('me.ledger-entries.index');

// The driver's own finished work — the Trips History screen. The third `/me`
// read in this module and the last of a set: earnings answer *how much*, the
// ledger answers *why is my balance that*, and this answers *what did I do*.
//
// Separate from `GET /trips`, which is the dispatch board: that endpoint's
// resource cannot serve `service_type` (the screen's filter) or the driver's
// own share of a fare, and the second is bounded away from list endpoints on
// purpose. See the controller.
Route::get('me/trips', [DriverTripHistoryController::class, 'index'])
    ->name('me.trips.index');

// Settling up (ADR-0032). The driver asks; the office answers, and **the
// answer is what writes the ledger entry** — the loop ADR-0029 §6 promised
// and never gave anybody a way to close.
//
// Money still does not move through this platform. Cash changes hands at the
// depot exactly as before; these routes record that it did.
Route::get('me/settlement-requests', [DriverSettlementRequestController::class, 'index'])
    ->name('me.settlement-requests.index');
Route::post('me/settlement-requests', [DriverSettlementRequestController::class, 'store'])
    ->name('me.settlement-requests.store');

// The office side. `drivers.manage` for now — ADR-0032 §5 records why that is
// a compromise and where the seam is when Finance separates from Fleet.
//
// Confirm and decline are POSTs to sub-paths rather than a PATCH on a status
// field, for the same reason the driver-application decisions are: each is a
// decision with its own audit meaning, and confirming in particular moves
// money in a ledger. A status field would make that look like an edit.
Route::get('settlement-requests', [SettlementRequestController::class, 'index'])
    ->name('settlement-requests.index');
Route::post('settlement-requests/{settlementRequest}/confirm', [SettlementRequestController::class, 'confirm'])
    ->name('settlement-requests.confirm');
Route::post('settlement-requests/{settlementRequest}/decline', [SettlementRequestController::class, 'decline'])
    ->name('settlement-requests.decline');

// The office side of a driver's papers (ADR-0033 §4). `drivers.manage` for
// now — the ADR records why that is a compromise and where the seam is if a
// Compliance role ever separates from Fleet.
//
// Verify and reject are POSTs to sub-paths rather than a PATCH on a status
// field, for the same reason the application and settlement decisions are:
// each is a decision with its own audit meaning, and a status field would make
// accepting somebody's licence look like an edit.
Route::get('drivers/{driver}/documents', [DriverDocumentReviewController::class, 'index'])
    ->name('drivers.documents.index');
Route::get('drivers/{driver}/documents/{document}/file', [DriverDocumentReviewController::class, 'file'])
    ->name('drivers.documents.file');
Route::post('drivers/{driver}/documents/{document}/verify', [DriverDocumentReviewController::class, 'verify'])
    ->name('drivers.documents.verify');
Route::post('drivers/{driver}/documents/{document}/reject', [DriverDocumentReviewController::class, 'reject'])
    ->name('drivers.documents.reject');

// The applications queue (ADR-0027). The submission half is public and
// lives in this module's public.php — these are the console side.
//
// Approve and reject are POSTs to sub-paths rather than a PATCH on a status
// field, for the reason ADR-0016 gives for the account sub-resource: they
// are decisions with their own permission and their own audit meaning, and
// approving in particular creates a driver, creates a user and links them.
// A status field would make all that look like an edit.
Route::get('driver-applications', [DriverApplicationController::class, 'index'])
    ->name('driver-applications.index');
Route::get('driver-applications/{driverApplication}', [DriverApplicationController::class, 'show'])
    ->name('driver-applications.show');
Route::post('driver-applications/{driverApplication}/approve', [DriverApplicationController::class, 'approve'])
    ->name('driver-applications.approve');
Route::post('driver-applications/{driverApplication}/reject', [DriverApplicationController::class, 'reject'])
    ->name('driver-applications.reject');
