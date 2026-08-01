<?php

use Illuminate\Support\Facades\Route;
use Modules\Reports\Controllers\TripReportController;

// Namespaced under /reports because driver, vehicle and financial reports
// follow (PROJECT.md Reports); `trips` here is the report, not the resource
// served by Modules/Trips.
Route::get('reports/trips', [TripReportController::class, 'index'])->name('reports.trips.index');
Route::get('reports/trips/export', [TripReportController::class, 'export'])->name('reports.trips.export');
