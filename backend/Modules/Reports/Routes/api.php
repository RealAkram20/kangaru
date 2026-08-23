<?php

use Illuminate\Support\Facades\Route;
use Modules\Reports\Controllers\DistanceReportController;
use Modules\Reports\Controllers\FinancialReportController;
use Modules\Reports\Controllers\FleetReportController;
use Modules\Reports\Controllers\ReportExportController;
use Modules\Reports\Controllers\TripReportController;

// Namespaced under /reports because these are reports, not the resources
// Modules/Trips, Modules/Drivers and Modules/Vehicles serve under the same
// nouns. PROJECT.md's four Phase 1 reports are all here.
Route::get('reports/trips', [TripReportController::class, 'index'])->name('reports.trips.index');

// Aggregates rather than row-per-trip, so neither is paginated: a tenant
// has tens of drivers, not tens of thousands.
Route::get('reports/drivers', [FleetReportController::class, 'drivers'])->name('reports.drivers.index');
Route::get('reports/vehicles', [FleetReportController::class, 'vehicles'])->name('reports.vehicles.index');

// Rows are periods, so this one is bounded by the granularity rather than
// by the fleet — a year grouped daily is 366 rows.
Route::get('reports/financial', [FinancialReportController::class, 'index'])->name('reports.financial.index');
// ADR-0045: the measured-distance shadow report. On-screen only, not
// exportable — the operator's instrument for judging the trace before the
// fare is priced from it.
Route::get('reports/distance', [DistanceReportController::class, 'index'])->name('reports.distance.index');

// Exports are their own resource rather than a verb on the report: they are
// produced asynchronously, outlive the request that asked for them, and are
// listed and downloaded separately.
Route::get('reports/exports', [ReportExportController::class, 'index'])->name('reports.exports.index');
Route::post('reports/exports', [ReportExportController::class, 'store'])->name('reports.exports.store');
Route::get('reports/exports/{export}', [ReportExportController::class, 'show'])->name('reports.exports.show');
Route::get('reports/exports/{export}/download', [ReportExportController::class, 'download'])
    ->name('reports.exports.download');
