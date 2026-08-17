<?php

use Illuminate\Support\Facades\Route;
use Modules\Drivers\Controllers\ClosureRequestController;
use Modules\Drivers\Controllers\DriverAccountController;
use Modules\Drivers\Controllers\DriverApplicationController;
use Modules\Drivers\Controllers\DriverClosureRequestController;
use Modules\Drivers\Controllers\DriverController;
use Modules\Drivers\Controllers\DriverDocumentController;
use Modules\Drivers\Controllers\DriverDocumentReviewController;
use Modules\Drivers\Controllers\DriverEarningsController;
use Modules\Drivers\Controllers\DriverLedgerController;
use Modules\Drivers\Controllers\DriverPayoutAccountController;
use Modules\Drivers\Controllers\DriverPerformanceController;
use Modules\Drivers\Controllers\DriverPhotoController;
use Modules\Drivers\Controllers\DriverProfileController;
use Modules\Drivers\Controllers\DriverPromotionController;
use Modules\Drivers\Controllers\DriverSettlementRequestController;
use Modules\Drivers\Controllers\DriverStatsController;
use Modules\Drivers\Controllers\DriverTripHistoryController;
use Modules\Drivers\Controllers\PayoutAccountController;
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

// How they are doing — the Performance screen's six dials and its weekly
// bonus card (ADR-0038). Separate from `me/stats` for the same reason
// `me/profile` is: stats is polled every sixty seconds, and a roster walk, a
// duty-session sum and a week of trips must not ride along on every poll of a
// screen that renders none of them.
Route::get('me/performance', [DriverPerformanceController::class, 'show'])
    ->name('me.performance.show');

// Who they are on the platform — the Profile screen. Separate from
// `me/stats` for the reason `me/earnings` is: stats is polled every sixty
// seconds on the home screen, and a lifetime trip count, a vehicle join and a
// documents summary should not ride along on every poll.
Route::get('me/profile', [DriverProfileController::class, 'show'])->name('me.profile.show');
// PATCH only, not PUT|PATCH — the route census compares method and path exactly,
// and the spec documents PATCH alone. Two fields, and the five the office keeps
// are argued in `UpdateDriverProfileRequest`.
Route::patch('me/profile', [DriverProfileController::class, 'update'])->name('me.profile.update');

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

// A driver's own photograph (ADR-0041). Streamed rather than served from a
// signed storage URL, for the reason ADR-0033 §3 gives about identity images —
// and it matters more here, not less: a licence scan is fetched once by a
// reviewer, this is fetched every time somebody opens the drawer.
//
// No id in any of the three paths. The driver is the token, so `show` needs no
// policy where `me/documents/{document}/file` does.
Route::get('me/photo', [DriverPhotoController::class, 'show'])->name('me.photo.show');
Route::post('me/photo', [DriverPhotoController::class, 'store'])->name('me.photo.store');
Route::delete('me/photo', [DriverPhotoController::class, 'destroy'])->name('me.photo.destroy');

// Where their money is sent (ADR-0042) — the Bank Details screen. Singular,
// because a driver has one destination or none: `PUT` attaches or replaces,
// `DELETE` takes it away, the shape ADR-0016 chose for the sign-in account.
//
// **Nothing here moves money.** ADR-0029 §6's boundary is unchanged; this
// records a destination so the office knows where to send what ADR-0032's
// confirm flow says is owed. The number comes back masked — the whole one is
// on the office route below, because a clerk cannot wire money to a mask.
Route::get('me/payout-account', [DriverPayoutAccountController::class, 'show'])
    ->name('me.payout-account.show');
Route::put('me/payout-account', [DriverPayoutAccountController::class, 'update'])
    ->name('me.payout-account.update');
Route::delete('me/payout-account', [DriverPayoutAccountController::class, 'destroy'])
    ->name('me.payout-account.destroy');

// The office half, and the loop is not closed without it: a payout destination
// the office cannot read is a form a driver filled in for nobody. Returns the
// whole account number, gated on `drivers.manage` through `DriverPolicy@view`.
Route::get('drivers/{driver}/payout-account', [PayoutAccountController::class, 'show'])
    ->name('drivers.payout-account.show');

// Closing an account, on the driver's own request (ADR-0043). Singular under
// `/me`: a driver has one current request or none.
//
// **Asking closes nothing.** The office's confirmation deactivates the driver
// and detaches their sign-in, and they are told by email — because by then they
// cannot sign in to be told any other way. `DELETE` is the driver withdrawing
// their own ask, which ADR-0032 left out of settlement requests and recorded as
// more annoying than it looked.
Route::get('me/closure-request', [DriverClosureRequestController::class, 'show'])
    ->name('me.closure-request.show');
Route::post('me/closure-request', [DriverClosureRequestController::class, 'store'])
    ->name('me.closure-request.store');
Route::delete('me/closure-request', [DriverClosureRequestController::class, 'destroy'])
    ->name('me.closure-request.destroy');

// The office queue, shipping with the feature rather than after it: a request
// to stop working, into silence, is the worst of the half-built loops the
// completeness census found. `drivers.manage`.
//
// Confirm and decline are POSTs to sub-paths rather than a PATCH on a status
// field, for the reason the settlement and document decisions are: each is a
// decision with its own audit meaning, and confirming ends somebody's ability
// to work. A status field would make that look like an edit.
Route::get('closure-requests', [ClosureRequestController::class, 'index'])
    ->name('closure-requests.index');
Route::post('closure-requests/{closureRequest}/confirm', [ClosureRequestController::class, 'confirm'])
    ->name('closure-requests.confirm');
Route::post('closure-requests/{closureRequest}/decline', [ClosureRequestController::class, 'decline'])
    ->name('closure-requests.decline');

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

// What the platform is currently offering them (ADR-0036, ADR-0037) — the
// Promotions screen. The fourth `/me` read, and the only one that looks
// *forward*: earnings, the ledger and the history are all records of what has
// happened, and this is the weekly target still open, tonight's peak window and
// what a referral would pay.
//
// Not folded into `me/stats`, which the home screen polls every sixty seconds.
// Three settings reads and a weekly trip count should not ride along on a poll
// nobody opened this screen for — the same separation `me/earnings` has.
Route::get('me/promotions', [DriverPromotionController::class, 'index'])
    ->name('me.promotions.index');

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
