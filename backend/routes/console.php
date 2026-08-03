<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Modules\Reports\Console\PruneReportExports;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Schedule
|--------------------------------------------------------------------------
|
| Module-owned scheduled work is registered here so the whole schedule is
| legible in one place rather than scattered across service providers.
|
*/

// Generated reports hold trip PII and are not kept indefinitely. A
// retention policy nothing enforces is a document, not a control.
Schedule::command(PruneReportExports::class)
    ->dailyAt('02:30')
    // Off-peak, and skipped if a previous run is somehow still going so a
    // slow prune never stacks up behind itself.
    ->withoutOverlapping()
    ->onOneServer();

// Expiry (ADR-0008) makes a token *invalid*; it does not delete the row.
// Without this, `personal_access_tokens` accumulates dead credentials
// forever — a growth problem, and a needlessly large blast radius for a
// database disclosure, since every hash ever issued would still be sitting
// there.
//
// Safe to run against a live system: it only removes rows already past
// `sanctum.expiration`, which the guard would refuse anyway. Nobody is
// signed out by this that was not already signed out.
Schedule::command('sanctum:prune-expired --hours=24')
    ->daily()
    ->withoutOverlapping()
    ->onOneServer();
