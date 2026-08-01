<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Billing timezone
    |--------------------------------------------------------------------------
    |
    | Night-rate windows are a local-time concept: "22:00 to 06:00" means
    | 22:00 where the vehicle is, not 22:00 UTC. The application stores and
    | reasons in UTC (config/app.php), so the pricing engine converts a
    | trip's start time into this zone before testing it against the rate
    | card's night window.
    |
    | Per-tenant timezones are deferred — every Phase 1 tenant operates in
    | Uganda. See Modules/Billing/README.md.
    |
    */

    'timezone' => env('BILLING_TIMEZONE', 'Africa/Kampala'),

    /*
    |--------------------------------------------------------------------------
    | Document number formats
    |--------------------------------------------------------------------------
    |
    | Invoice and credit note numbers are sequential per tenant per year,
    | allocated under a locked counter row (AGENTS.md: "Gaps and duplicates
    | are both audit findings for bank clients"). Changing the prefix or
    | padding changes only how future numbers are rendered; already-issued
    | numbers are stored as strings and are never recomputed.
    |
    */

    'invoice_number' => [
        'prefix' => env('BILLING_INVOICE_PREFIX', 'INV'),
        'padding' => 6,
    ],

    'credit_note_number' => [
        'prefix' => env('BILLING_CREDIT_NOTE_PREFIX', 'CRN'),
        'padding' => 6,
    ],

];
