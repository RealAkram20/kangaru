<?php

use Illuminate\Support\Facades\Route;
use Modules\Clients\Controllers\ClientLookupController;
use Modules\Clients\Controllers\ClientPlaceController;
use Modules\Clients\Controllers\ClientRouteController;
use Modules\Clients\Controllers\ClientRoutePreviewController;
use Modules\Clients\Controllers\CompanyController;
use Modules\Clients\Controllers\ContractController;

// `except` + an explicit PATCH: `apiResource` registers update as
// PUT|PATCH, but AGENTS.md's RESTful naming commits to PATCH alone, and
// ADR-0011's route census holds the spec and the route table to the same
// list. Nothing external consumes the API yet, so removing the verb now is
// free; once the driver app ships it would be a breaking change.
// Is this company already on Kangaru? (ADR-0060 §3.) A boolean and nothing
// else — no name, no address, no hint of who serves them. Throttled not
// because a registration number is guessable, but because an endpoint that
// answers yes/no about other people's rows should never be free to hammer.
Route::get('clients/lookup', [ClientLookupController::class, 'show'])
    ->middleware('throttle:30,1')
    ->name('clients.lookup');

// The contracts between a fleet and a client (ADR-0060). Three verbs, three
// different parties: a fleet asks, the client answers, either side ends it.
Route::get('contracts', [ContractController::class, 'index'])->name('contracts.index');
Route::post('contracts', [ContractController::class, 'store'])->name('contracts.store');
Route::post('contracts/{contract}/approval', [ContractController::class, 'approve'])->name('contracts.approve');
Route::delete('contracts/{contract}', [ContractController::class, 'destroy'])->name('contracts.destroy');

Route::apiResource('companies', CompanyController::class)->except(['update']);
Route::patch('companies/{company}', [CompanyController::class, 'update'])->name('companies.update');

// ADR-0045: the client's own places and the circuits built from them.
// Same `except(['update'])` + explicit PATCH shape as companies above, and
// for the same reason — ADR-0011's census holds the spec and the route
// table to one list, and `apiResource` would register a PUT nobody serves.
Route::apiResource('places', ClientPlaceController::class)->except(['update'])
    ->parameters(['places' => 'place']);
Route::patch('places/{place}', [ClientPlaceController::class, 'update'])->name('places.update');

// Before the resource, so `routes/preview` is not swallowed by
// `routes/{route}` and answered with a 404 for a non-numeric id.
Route::post('routes/preview', [ClientRoutePreviewController::class, 'store'])->name('routes.preview');

Route::apiResource('routes', ClientRouteController::class)->except(['update'])
    ->parameters(['routes' => 'route']);
Route::patch('routes/{route}', [ClientRouteController::class, 'update'])->name('routes.update');
