<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Modules\Dispatch\Console\AdvanceDispatchOffers;
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

// Automatic dispatch's backstop (ADR-0024 §5).
//
// **This is not what makes an offer expire.** `expires_at` is a wall clock
// and every read evaluates it, so a driver cannot accept a lapsed offer and
// a customer never sees one — whether or not this has ever run. What this
// does is notice, and offer the ride to the next driver.
//
// The common case does not wait for it: a driver who actually declines
// advances the search in the same request. This is the backstop for the
// driver who says nothing at all.
//
// `everyMinute()` is cron's floor, which is coarse against a 15-second offer
// window — a passenger can wait out one tick for somebody who ignored their
// phone. That is the honest cost of not requiring a daemon, and a deployment
// running a worker can lower it to `everyTenSeconds()` with no code change.
Schedule::command(AdvanceDispatchOffers::class)
    ->everyMinute()
    // A slow sweep must never stack up behind itself: two concurrent runs
    // would race to settle the same offers and could open two waves on one
    // ride.
    ->withoutOverlapping()
    ->onOneServer();
