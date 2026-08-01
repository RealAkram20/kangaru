<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Platform currency
    |--------------------------------------------------------------------------
    |
    | AGENTS.md "Money & Billing Standards": all monetary amounts are stored
    | as integers in the currency's minor unit. UGX is a zero-decimal
    | currency, so a stored `..._minor` integer is a whole shilling.
    |
    | Phase 1 is single-currency (PROJECT.md defers multi-currency), so this
    | is a platform constant rather than a per-tenant setting. Financial
    | records still persist their own `currency` column, so the day a second
    | currency arrives, history is not ambiguous about what its integers
    | meant.
    |
    */

    'currency' => env('MONEY_CURRENCY', 'UGX'),

    /*
    |--------------------------------------------------------------------------
    | Default rounding
    |--------------------------------------------------------------------------
    |
    | AGENTS.md: "Rounding rules are defined per rate card (default: round
    | half-up to nearest shilling)." This is only the default offered when a
    | rate card version does not state one — the value actually used is
    | persisted on the rate card version and copied onto every invoice line,
    | so an invoice never depends on what this file happens to say today.
    |
    | Must be one of Modules\Billing\Enums\RoundingMode.
    |
    */

    'default_rounding' => env('MONEY_DEFAULT_ROUNDING', 'half_up'),

];
