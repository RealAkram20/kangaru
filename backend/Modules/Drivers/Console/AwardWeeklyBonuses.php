<?php

namespace Modules\Drivers\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Modules\Drivers\Services\WeeklyBonusService;

/**
 * Awards the weekly target bonus for a closed week (ADR-0034 §4).
 *
 * Scheduled weekly. **It runs over the week that has just ended, never the
 * one in progress** — a partial week cannot be measured against a weekly
 * target, and a driver shown a bonus that later un-awards itself has been lied
 * to about money.
 *
 * Safe to run twice, and that is a database guarantee rather than a promise
 * this class makes: `driver_weekly_bonuses` carries a unique index on
 * `(driver_id, week_start)`, and a second attempt is a no-op. Re-running after
 * a failure is therefore the correct response to a failure.
 *
 * `--week=` exists for exactly that: awarding a week the schedule missed,
 * without waiting for the next one.
 */
class AwardWeeklyBonuses extends Command
{
    protected $signature = 'drivers:award-weekly-bonuses
                            {--week= : The Monday of the week to award, YYYY-MM-DD. Defaults to the week just ended.}';

    protected $description = 'Credits the weekly target bonus to every driver who cleared it (ADR-0034).';

    public function handle(WeeklyBonusService $bonuses): int
    {
        if (! $bonuses->enabled()) {
            // Not a failure. The scheme is off by default and an operator who
            // has not switched it on should see a sentence rather than a
            // silent success they cannot distinguish from a quiet week.
            $this->info('Weekly bonuses are switched off (billing.bonus_enabled). Nothing awarded.');

            return self::SUCCESS;
        }

        $option = $this->option('week');

        try {
            $week = is_string($option) && $option !== ''
                ? CarbonImmutable::createFromFormat('Y-m-d', $option)?->startOfDay()
                : $bonuses->lastClosedWeek();
        } catch (\Throwable) {
            $week = null;
        }

        if ($week === null) {
            $this->error('--week must be a date in YYYY-MM-DD form.');

            return self::FAILURE;
        }

        $awarded = $bonuses->awardFor($week);

        $this->info(sprintf(
            'Week of %s: %d driver(s) awarded %s at a target of %d trips.',
            $week->toDateString(),
            $awarded,
            number_format($bonuses->amountMinor()),
            $bonuses->tripTarget(),
        ));

        return self::SUCCESS;
    }
}
