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
