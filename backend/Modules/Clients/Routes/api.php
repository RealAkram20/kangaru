<?php

use Illuminate\Support\Facades\Route;
use Modules\Clients\Controllers\CompanyController;

Route::apiResource('companies', CompanyController::class);
