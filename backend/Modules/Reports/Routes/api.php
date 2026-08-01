<?php

use Illuminate\Support\Facades\Route;
use Modules\Reports\Controllers\ReportExportController;
use Modules\Reports\Controllers\TripReportController;

// Namespaced under /reports because driver, vehicle and financial reports
// follow (PROJECT.md Reports); `trips` here is the report, not the resource
// served by Modules/Trips.
Route::get('reports/trips', [TripReportController::class, 'index'])->name('reports.trips.index');

// Exports are their own resource rather than a verb on the report: they are
// produced asynchronously, outlive the request that asked for them, and are
// listed and downloaded separately.
Route::get('reports/exports', [ReportExportController::class, 'index'])->name('reports.exports.index');
Route::post('reports/exports', [ReportExportController::class, 'store'])->name('reports.exports.store');
Route::get('reports/exports/{export}', [ReportExportController::class, 'show'])->name('reports.exports.show');
Route::get('reports/exports/{export}/download', [ReportExportController::class, 'download'])
    ->name('reports.exports.download');
