<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Modules\Administration\Console\SendInvitationReminders;
use Modules\Dispatch\Console\AdvanceDispatchOffers;
use Modules\Drivers\Console\AwardWeeklyBonuses;
use Modules\Drivers\Console\PruneAbandonedApplicationDocuments;
use Modules\Drivers\Console\SendExpiringDocumentReminders;
use Modules\Fleet\Console\CloseStaleDutySessions;
use Modules\Reports\Console\PruneReportExports;
use Modules\Trips\Console\MaintainTripLocationPartitions;

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
// Every ten seconds, against a fifteen-second offer window.
//
// `everyMinute()` was cron's floor and it was four times coarser than the
// thing it sweeps: a driver who ignored their phone burned their 15 seconds
// and the ride then sat untouched for up to another 60 while the passenger
// watched a spinner. Worst case from order to second driver was about 75
// seconds, and almost all of it was this tick.
//
// Laravel 12 runs sub-minute tasks under both `schedule:work` and a
// cron-driven `schedule:run` — the scheduler stays resident for the minute to
// service them — so this no longer costs a daemon requirement the way the
// original note assumed. Ten seconds bounds the gap at roughly the offer
// window itself.
//
// It is not a substitute for the immediate paths, which still carry the
// common cases: `dispatch()` runs inside the request that receives the order,
// and `decline()` advances the search in the driver's own request. This is
// the backstop for silence, and silence is now noticed in ten seconds.
Schedule::command(AdvanceDispatchOffers::class)
    ->everyTenSeconds()
    // A slow sweep must never stack up behind itself: two concurrent runs
    // would race to settle the same offers and could open two waves on one
    // ride.
    ->withoutOverlapping()
    ->onOneServer();

// The weekly target bonus (ADR-0034 §4). Monday morning, over the week that
// has just closed — never the week in progress, because a partial week cannot
// be measured against a weekly target and a driver shown a bonus that later
// un-awards itself has been lied to about money.
//
// 03:15 rather than midnight: the boundaries are the fleet's local week
// (`settings.regional.timezone`), and running comfortably clear of it means a
// trip finishing at 23:58 on Sunday is already settled and in the ledger.
//
// `onOneServer` **and** a unique index on `(driver_id, week_start)`. The first
// is the ordinary precaution; the second is what makes a double award
// impossible rather than unlikely, which is the standard payroll deserves.
// Re-running by hand after a failure is therefore safe and is the intended
// response to one — see `--week`.
Schedule::command(AwardWeeklyBonuses::class)
    ->weeklyOn(1, '03:15')
    ->withoutOverlapping()
    ->onOneServer();

// Ends duty sessions the platform has stopped hearing from (ADR-0038), at
// their last heartbeat rather than at this tick's "now".
//
// **This is not what stops a quiet driver being offered work.** The same TTL
// is evaluated on every `dispatchable()` read, so that happens whether or not
// this has ever run. What this does is write down when the shift stopped, so
// online hours are measured rather than assumed — which is why a missed run
// costs timeliness and not accuracy: the next run closes the session at the
// same last heartbeat it would have used an hour earlier.
//
// Every minute, against a 180-second TTL. Finer would be spending queries to
// sharpen a figure that is rendered to the nearest minute.
Schedule::command(CloseStaleDutySessions::class)
    ->everyMinute()
    // A slow sweep must not stack behind itself: two runs would both read the
    // same open sessions and race to close them.
    ->withoutOverlapping()
    ->onOneServer();

// Destroys the uploads of driver applications nobody ever decided
// (ADR-0048 §5).
//
// **This is a data-protection obligation, not housekeeping.** Approval carries
// an applicant's documents onto the new driver and rejection destroys them; an
// application that is simply never decided is the third ending, and without
// this it means a photograph of a stranger's face and national ID living on
// the operator's disk indefinitely, against somebody who was never employed
// and never refused.
//
// Registered here in the same change as the ADR that promises it. ADR-0029
// created an obligation with no machinery and nothing discharged it for ten
// months; the `MaintainTripLocationPartitions` note below records the same
// failure in the other direction — a command written and never scheduled.
//
// Daily and off-peak. The window is 90 days, so the cost of a missed run is
// measured in hours against a quarter, and `withoutOverlapping` matters more
// than the exact hour: the sweep deletes files, and two of them racing over
// one application is not a thing to find out about later.
Schedule::command(PruneAbandonedApplicationDocuments::class)
    ->dailyAt('03:40')
    ->withoutOverlapping()
    ->onOneServer();

// `trip_locations` partition maintenance (ADR-0003), and it does two jobs.
//
// **It was written and never scheduled.** The command has existed since the
// partitioned table shipped, is registered in `bootstrap/app.php`, and its own
// docblock says "Intended to run monthly from the scheduler" — but it was
// absent from this file, which is the only place that would have run it. W1-e's
// census reported "no GPS prune at 12 months" for exactly that reason; the
// prune was there, nothing called it.
//
// **Neither half fails loudly, which is why it survived unnoticed.** Ingestion
// keeps working because `p_future` is a MAXVALUE catch-all, so rows land
// somewhere and no error is raised — they simply all land in one partition, and
// the monthly carving that ADR-0003 calls this platform's growth mitigation
// stops mitigating. And the 12-month retention **the public privacy notice now
// states** (`docs/data-inventory.md` §6) silently never happens, because
// retiring a month is `DROP PARTITION` and nothing was dropping one.
//
// Monthly, on the 1st, well clear of both the month boundary it reorganises
// around and the 02:30 report prune. Safe to re-run by hand after a failure:
// adding a partition that exists and dropping one that does not are both
// no-ops, and `--dry-run` reports without altering.
Schedule::command(MaintainTripLocationPartitions::class)
    ->monthlyOn(1, '03:45')
    // A reorganise is the one operation here that rewrites data. Two at once
    // on the same table is not a race this needs to find out about.
    ->withoutOverlapping()
    ->onOneServer();

/*
 | One reminder a day, for invitations lapsing inside the next 24 hours
 | (mail plan A2).
 |
 | 09:00 rather than overnight, deliberately. The reader's remedy is to open a
 | link and choose a password, and something that arrives at 03:00 is at the
 | bottom of the inbox by the time anybody is at a desk. Nothing here is
 | time-critical enough to justify waking a queue at an odd hour.
 |
 | `withoutOverlapping` because the send is per invitation and a slow mail
 | server on a bad morning could otherwise have two runs reminding the same
 | people twice. There is no `reminded_at` column to stop it: the window is the
 | idempotence, and the window only works if the command runs once.
 */
Schedule::command(SendInvitationReminders::class)
    ->dailyAt('09:00')
    ->withoutOverlapping();

/*
 | Document expiry warnings: 30 days out, 7 days out, and the day itself
 | (mail plan M4, AGENTS.md's "Document Expiring").
 |
 | 06:30 in the platform's own timezone, which is early enough that a driver
 | reads it before a shift and late enough that it is not sitting under
 | overnight noise. The command resolves "today" in Africa/Kampala itself, so
 | this schedule time only decides when it runs, never which documents match.
 |
 | The offsets are exact date matches, which is what makes a daily run
 | idempotent with no `reminded_at` column. It also means a skipped day is not
 | sent late: a "30 days left" email arriving on day 26 is wrong in a way the
 | reader cannot detect, and the 7-day warning catches them anyway.
 */
Schedule::command(SendExpiringDocumentReminders::class)
    ->dailyAt('06:30')
    ->withoutOverlapping();
