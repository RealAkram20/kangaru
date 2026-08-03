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
    // Unauthenticated by design (ADR-0012): the walk-in order form. Each
    // module's public.php carries its own throttle; nothing in it may
    // assume a user or a tenant.
    require base_path('Modules/Bookings/Routes/public.php');

    require base_path('Modules/Administration/Routes/api.php');

    // `tenant` binds the actor's own tenant before model binding;
    // `subject-tenant` binds the acted-on record's tenant after it, for
    // platform staff who have none of their own (ADR-0006). Both are forced
    // into the right slots by bootstrap/app.php's priority list — the order
    // written here is not what decides it.
    Route::middleware(['auth:sanctum', 'tenant', 'subject-tenant'])->group(function () {
        require base_path('Modules/Clients/Routes/api.php');
        require base_path('Modules/Vehicles/Routes/api.php');
        require base_path('Modules/Drivers/Routes/api.php');
        require base_path('Modules/Fleet/Routes/api.php');
        require base_path('Modules/Bookings/Routes/api.php');
        require base_path('Modules/Dispatch/Routes/api.php');
        require base_path('Modules/Trips/Routes/api.php');
        require base_path('Modules/Billing/Routes/api.php');
        require base_path('Modules/Reports/Routes/api.php');
        require base_path('Modules/Notifications/Routes/api.php');
    });
});
