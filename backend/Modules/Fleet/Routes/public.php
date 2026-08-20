<?php

use Illuminate\Support\Facades\Route;
use Modules\Fleet\Controllers\PublicNearbyVehicleController;

/*
|--------------------------------------------------------------------------
| Public routes (no authentication)
|--------------------------------------------------------------------------
|
| Kept in a separate file from the module's authenticated routes so the
| difference is impossible to miss in review: everything in here is
| reachable by anyone on the internet, and each route must carry its own
| throttle.
|
| One route: the anonymized nearby-vehicles read behind the order page's
| ambient fleet and the client live map's capacity view. 30/min/IP — the
| same allowance as /public/fare-quotes, and six times what the page's
| 10-second poll actually spends. The response is bounded (radius and
| count) and carries no identity, so the worst a scraper gets is what any
| passer-by sees standing on the kerb: there are cars about.
|
*/

Route::get('public/nearby-vehicles', [PublicNearbyVehicleController::class, 'index'])
    ->middleware('throttle:30,1')
    ->name('public.nearby-vehicles.index');
