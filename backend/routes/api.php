<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| A thin aggregator: every module owns its own route file under
| Modules/{Name}/Routes/api.php (organize by feature — AGENTS.md), while
| this file keeps everything under /api/v1 in one place.
|
*/

Route::prefix('v1')->group(function () {
    require base_path('Modules/Administration/Routes/api.php');

    Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
        require base_path('Modules/Clients/Routes/api.php');
        require base_path('Modules/Vehicles/Routes/api.php');
        require base_path('Modules/Drivers/Routes/api.php');
        require base_path('Modules/Bookings/Routes/api.php');
        require base_path('Modules/Dispatch/Routes/api.php');
        require base_path('Modules/Trips/Routes/api.php');
        require base_path('Modules/Reports/Routes/api.php');
    });
});
