<?php

use Illuminate\Support\Facades\Route;
use Modules\Billing\Controllers\CreditNoteController;
use Modules\Billing\Controllers\InvoiceController;
use Modules\Billing\Controllers\RateCardController;

// Rate cards: create and read, plus adding a version. Deliberately no
// PATCH and no DELETE — AGENTS.md requires a rate card to be immutable
// once used, so the only way to change prices is a new version.
Route::apiResource('rate-cards', RateCardController::class)->only(['index', 'show', 'store']);
Route::post('rate-cards/{rateCard}/versions', [RateCardController::class, 'storeVersion'])
    ->name('rate-cards.versions.store');
Route::put('rate-cards/{rateCard}/default', [RateCardController::class, 'makeDefault'])
    ->name('rate-cards.default.update');

// Invoices: read-only as a collection. The only way one comes into
// existence is by billing a completed trip, which is why the create route
// hangs off the trip rather than off /invoices.
Route::apiResource('invoices', InvoiceController::class)->only(['index', 'show']);
Route::post('trips/{trip}/invoice', [InvoiceController::class, 'store'])->name('trips.invoice.store');

// Credit notes: the module's only correction mechanism, and meaningless
// away from the invoice they correct.
Route::get('invoices/{invoice}/credit-notes', [CreditNoteController::class, 'index'])
    ->name('invoices.credit-notes.index');
Route::post('invoices/{invoice}/credit-notes', [CreditNoteController::class, 'store'])
    ->name('invoices.credit-notes.store');
