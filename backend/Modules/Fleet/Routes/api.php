<?php

use Illuminate\Support\Facades\Route;
use Modules\Fleet\Controllers\AvailabilityBlockController;
use Modules\Fleet\Controllers\DriverAvailabilityController;
use Modules\Fleet\Controllers\DriverPresenceController;
use Modules\Fleet\Controllers\KangaruOverviewController;
use Modules\Fleet\Controllers\OnDutyDriverController;
use Modules\Fleet\Controllers\OperatorAccountController;
use Modules\Fleet\Controllers\OperatorController;
use Modules\Fleet\Controllers\VehicleAllocationController;
use Modules\Fleet\Controllers\ZoneController;

// The register of fleet companies (ADR-0055, ADR-0059) — head office's, and
// nobody else's. `OperatorPolicy` requires `access_level = kangaru` on every
// method, so a fleet's own Super Admin holds the permission and is refused.
//
// No destroy route: six operational tables carry `operator_id` and
// `operator_client` restricts on delete, so a fleet that leaves is suspended
// rather than removed — which keeps its trips explicable.
Route::get('operators', [OperatorController::class, 'index'])->name('operators.index');
Route::post('operators', [OperatorController::class, 'store'])->name('operators.store');
Route::get('operators/{operator}', [OperatorController::class, 'show'])->name('operators.show');
Route::patch('operators/{operator}', [OperatorController::class, 'update'])->name('operators.update');

// Who head office can act as at this fleet (ADR-0056). A person, never an
// organisation — so Log in as needs somebody to name. Separate from
// `OperatorResource`, which is counts-only on purpose.
Route::get('operators/{operator}/accounts', [OperatorAccountController::class, 'index'])
    ->name('operators.accounts.index');

// What head office sees when it signs in (ADR-0059). Counts only — a list
// would be the cross-fleet read ADR-0055 §2 forbids, and the difference is
// one endpoint.
Route::get('kangaru/overview', [KangaruOverviewController::class, 'show'])
    ->name('kangaru.overview');

// `Modules/Fleet`'s first routes (ADR-0009). Nested under nothing: an
// allocation is about one vehicle and one client but belongs to neither
// listing, and platform staff read it across every client.
Route::get('allocations', [VehicleAllocationController::class, 'index'])->name('allocations.index');
Route::post('allocations', [VehicleAllocationController::class, 'store'])->name('allocations.store');
Route::get('allocations/{allocation}', [VehicleAllocationController::class, 'show'])->name('allocations.show');

// Ending is the only mutation offered. Moving a contract's start after the
// fact would rewrite which days a client was owed a vehicle, and the trips
// dispatched under it would stop being explicable — see
// EndVehicleAllocationRequest.
Route::patch('allocations/{allocation}', [VehicleAllocationController::class, 'end'])->name('allocations.end');

// Availability — who and what is off the road, and when (ADR-0017).
//
// A flat collection rather than sub-resources under drivers and vehicles:
// "what is out this week" crosses both, and two endpoints would have to be
// merged by every caller that asked it.
Route::get('availability-blocks', [AvailabilityBlockController::class, 'index'])
    ->name('availability-blocks.index');
Route::post('availability-blocks', [AvailabilityBlockController::class, 'store'])
    ->name('availability-blocks.store');
// Where the fleet office answers a driver's request for time off — the far
// end of the Driver's Application (Phase 2).
Route::post('availability-blocks/{availabilityBlock}/answer', [AvailabilityBlockController::class, 'answer'])
    ->name('availability-blocks.answer');
Route::delete('availability-blocks/{availabilityBlock}', [AvailabilityBlockController::class, 'destroy'])
    ->name('availability-blocks.destroy');

// Geofences (ADR-0021). `resolve` is declared before the `{zone}` routes so
// the literal segment is not swallowed by the parameter.
Route::get('zones', [ZoneController::class, 'index'])->name('zones.index');
Route::get('zones/resolve', [ZoneController::class, 'resolve'])->name('zones.resolve');
Route::post('zones', [ZoneController::class, 'store'])->name('zones.store');
Route::patch('zones/{zone}', [ZoneController::class, 'update'])->name('zones.update');
Route::delete('zones/{zone}', [ZoneController::class, 'destroy'])->name('zones.destroy');

// A driver asking for their own time off — the Driver's Application's half
// of ADR-0017 §6. `/me/` rather than `/drivers/{id}/`: an id in the path is
// a thing to tamper with, and these routes take no `resource_id` at all.
//
// Throttled: a request is a human act a few times a month, and the mobile
// client retrying a failed submit must not be able to fill the office's
// queue with duplicates.
Route::get('me/availability-requests', [DriverAvailabilityController::class, 'index'])
    ->name('me.availability-requests.index');
Route::post('me/availability-requests', [DriverAvailabilityController::class, 'store'])
    ->middleware('throttle:10,1')
    ->name('me.availability-requests.store');
Route::delete('me/availability-requests/{availabilityBlock}', [DriverAvailabilityController::class, 'destroy'])
    ->name('me.availability-requests.destroy');

// A driver going on duty and saying where they are (ADR-0024 §2) — the
// input automatic dispatch was missing, because `live_positions` only knows
// about vehicles already on a trip.
//
// `/me/` for the same reason as the time-off routes above: the driver is the
// token, and an id in the path is a thing to tamper with.
Route::get('me/duty', [DriverPresenceController::class, 'show'])->name('me.duty.show');

// PUT, not POST: going on duty is idempotent and there is exactly one duty
// state per driver to replace. A driver whose request times out and retries
// must not end up having started two shifts.
Route::put('me/duty', [DriverPresenceController::class, 'update'])->name('me.duty.update');

// The heartbeat. Throttled well above the configured cadence
// (`dispatch.presence_heartbeat_seconds`, 60s by default) so an ordinary
// retry after a dead zone is never refused, but a handset stuck in a loop
// cannot hammer the dispatch table all day.
Route::post('me/presence', [DriverPresenceController::class, 'ping'])
    ->middleware('throttle:30,1')
    ->name('me.presence.store');

// The office's read of the same presence: who is on duty and where, for
// the live map. Not under `/me/` — this is somebody else looking — and
// gated by `DriverPolicy::viewAny`, the fleet register's own read, which
// a client's roles do not hold (security-gate F2).
Route::get('driver-presence', [OnDutyDriverController::class, 'index'])->name('driver-presence.index');
