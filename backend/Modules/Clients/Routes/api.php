<?php

use Illuminate\Support\Facades\Route;
use Modules\Clients\Controllers\CompanyController;

// `except` + an explicit PATCH: `apiResource` registers update as
// PUT|PATCH, but AGENTS.md's RESTful naming commits to PATCH alone, and
// ADR-0011's route census holds the spec and the route table to the same
// list. Nothing external consumes the API yet, so removing the verb now is
// free; once the driver app ships it would be a breaking change.
Route::apiResource('companies', CompanyController::class)->except(['update']);
Route::patch('companies/{company}', [CompanyController::class, 'update'])->name('companies.update');
