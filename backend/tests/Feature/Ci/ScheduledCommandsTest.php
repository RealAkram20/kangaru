<?php

/**
 * Every command that must run on a schedule is actually on one.
 *
 * **This test exists because one was not, for weeks, and nothing noticed.**
 * `MaintainTripLocationPartitions` was written, documented ("Intended to run
 * monthly from the scheduler"), and registered in `bootstrap/app.php` — so
 * `php artisan trip-locations:maintain` worked perfectly whenever a human
 * typed it, and `routes/console.php` never called it. Registration and
 * scheduling look alike from the outside and are unrelated.
 *
 * Both of that command's jobs fail **silently**, which is why no bug report
 * would ever have surfaced it:
 *
 * 1. It carves next month's partition out of the `p_future` MAXVALUE
 *    catch-all. Unscheduled, ingestion keeps working — rows land in the
 *    catch-all — and the monthly partitioning ADR-0003 calls this platform's
 *    growth mitigation stops mitigating, with no error anywhere.
 * 2. It drops partitions past `tracking.retention_months`. Unscheduled, the
 *    12-month raw-GPS retention that `docs/data-inventory.md` §6 states **in
 *    a public privacy notice** simply never happens.
 *
 * A unit test of the command's own logic would have passed throughout. The
 * defect was never in the command; it was in the wiring, so the wiring is
 * what is asserted here.
 */

use Illuminate\Console\Scheduling\Schedule;

/**
 * The commands whose absence from the schedule is a silent failure, and what
 * that failure costs. Keyed by the artisan signature the scheduler emits.
 *
 * Deliberately not "every scheduled command": pinning the whole list would
 * make this test an inventory that fails whenever somebody adds unrelated
 * work, and a test that fails for reasons unrelated to its subject gets
 * deleted. These are the ones with a stated consequence.
 */
function scheduleCriticalCommands(): array
{
    return [
        'trip-locations:maintain' => 'raw GPS is never pruned and new months are never carved (ADR-0003)',
        'reports:prune-exports' => 'generated exports holding trip PII are kept forever',
        'dispatch:advance-offers' => 'an offer nobody answers never advances — dispatch stalls with no error',
        'duty:close-stale' => 'duty sessions never close, so online hours are wrong',
        'drivers:award-weekly-bonuses' => 'the weekly target bonus is never paid (ADR-0034 §4)',
    ];
}

/**
 * The artisan portion of each scheduled event, e.g. `trip-locations:maintain`.
 *
 * `Event::$command` is the full shell invocation — a PHP binary path, an
 * `artisan` path, and the signature, all quoted. The signature is matched
 * within it rather than parsed out, because the surrounding shape is
 * platform-dependent and would make this assert the test runner's filesystem
 * layout instead of the schedule.
 *
 * @return array<int, string>
 */
function scheduledCommandLines(): array
{
    return collect(app(Schedule::class)->events())
        ->map(fn ($event) => (string) $event->command)
        ->all();
}

it('schedules every command whose absence fails silently', function (): void {
    $lines = scheduledCommandLines();

    $missing = [];

    foreach (scheduleCriticalCommands() as $signature => $consequence) {
        $found = collect($lines)->contains(fn (string $line) => str_contains($line, $signature));

        if (! $found) {
            $missing[] = sprintf('%s — %s', $signature, $consequence);
        }
    }

    expect($missing)->toBe([], sprintf(
        "Registered but not scheduled. Being in bootstrap/app.php's withCommands() only makes a "
        ."command typeable by hand:\n%s",
        implode("\n", $missing),
    ));
});

/**
 * The assertion above passes vacuously if `events()` comes back empty — which
 * it would if the schedule moved out of `routes/console.php`, or if this test
 * resolved a Schedule the console kernel had not populated. Then every
 * `str_contains` runs against nothing, finds nothing, and reports nothing
 * missing.
 */
it('reads a schedule that is actually populated', function (): void {
    expect(scheduledCommandLines())->not->toBeEmpty();
});
