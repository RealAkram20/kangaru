<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Services\DutySessionService;

/**
 * Everything the Performance screen draws, in one read.
 *
 * Six dials and a weekly progress card. Nothing here is computed that is not
 * counted from rows that already exist, and **every ratio on the screen has a
 * real denominator or none at all** — which is the whole reason this service
 * exists rather than the screen assembling three endpoints.
 *
 * ## Why a denominator was the hard part
 *
 * A ring is a fraction of something. Four of the six dials have an obvious
 * ceiling — five stars, and 100% for the three rates. The other two, as the
 * mockup drew them, had none: *Total Trips 428* and *Online Hours 7h 20m*
 * were both drawn about three-quarters full, against nothing.
 *
 * `docs/screen-rules.md` §1 forbids inventing the missing number, and the
 * waiting screen's `pickup_wait_target_seconds` shows what containing an
 * invented ceiling costs when one is genuinely unavoidable. Here it was
 * avoidable, so the two dials were given real ceilings instead:
 *
 * - **Trips this week**, against `billing.bonus_weekly_trip_target` — a
 *   figure the operator sets and the driver is actually working towards.
 * - **Online hours this week**, against the hours they are **rostered** for
 *   (ADR-0017 §3).
 *
 * Both denominators are nullable, and null is served rather than a zero: the
 * bonus scheme is off by default, and a driver with no shift windows is
 * available at any hour, which is not a number. The app draws no arc for
 * either, and a dial with no arc is a fact without a claim about it.
 *
 * ## Why this is not more fields on `/me/stats`
 *
 * `Routes/api.php` already gives the reasoning for splitting `me/profile` and
 * `me/earnings` off it: stats is polled every sixty seconds by the home
 * screen, and a roster walk, a duty-session sum and a bonus-progress count
 * must not ride along on every poll of a screen that renders none of them.
 * The 30-day rates *are* shared, through `DriverStatsService::qualityFor()`,
 * so the two surfaces cannot disagree about acceptance.
 */
class DriverPerformanceService
{
    public function __construct(
        private readonly DriverStatsService $stats,
        private readonly WeeklyBonusService $bonuses,
        private readonly DriverEarningsService $earnings,
        private readonly DutySessionService $duty,
        private readonly DriverProfileService $profiles,
    ) {}

    /**
     * @return array{
     *     acceptance_rate: float|null,
     *     completion_rate: float|null,
     *     cancellation_rate: float|null,
     *     rating: float|null,
     *     rating_count: int,
     *     window_days: int,
     *     trips_total: int,
     *     week_start: string,
     *     timezone: string,
     *     trips_this_week: int,
     *     online_seconds_this_week: int,
     *     rostered_seconds_this_week: int|null,
     *     bonus: array{
     *         trips: int,
     *         trip_target: int,
     *         amount_minor: int,
     *         currency: string,
     *         week_start: string,
     *         ends_at: string,
     *         achieved: bool
     *     }|null
     * }
     */
    public function forDriver(Driver $driver): array
    {
        $timezone = $this->earnings->timezone();
        $now = CarbonImmutable::now($timezone);
        $weekStart = $this->bonuses->currentWeek($now);
        $weekEnd = $weekStart->addWeek();

        return [
            ...$this->stats->qualityFor($driver),

            // Completed trips, ever. The mockup's *Total Trips* figure, kept
            // as a number even though its dial no longer draws an arc for it
            // — a lifetime count is the one fact on this screen a driver is
            // most likely to be proud of, and dropping it to solve a drawing
            // problem would have been solving the wrong thing.
            //
            // The profile header shows the same figure, and this calls the
            // same method rather than counting again — a second copy of the
            // query is a second place for "does a cancellation count" to be
            // answered differently.
            'trips_total' => $this->profiles->tripsCompleted($driver),

            // Served, never assumed. The week's boundaries are the *fleet's*,
            // and a handset near a border must not draw its own.
            'week_start' => $weekStart->toDateString(),
            'timezone' => $timezone,

            'trips_this_week' => $this->bonuses->tripsInWeek((int) $driver->getKey(), $weekStart),

            // Measured, at last (ADR-0038). Seconds rather than a formatted
            // string: rendering "7h 20m" is the app's job and its own
            // `durationLabel` already does it, in the app's language.
            'online_seconds_this_week' => $this->duty->secondsIn((int) $driver->getKey(), $weekStart, $now),

            // **The whole week's roster, not the part of it that has passed.**
            // Measuring against the roster-so-far would show a driver keeping
            // to their shifts as 100% every day of the week, which says
            // nothing; against the whole week it answers the question they
            // actually have, which is how much of their committed week is
            // behind them.
            //
            // Null for a driver with no roster — ADR-0017 §3 makes that mean
            // "available at any hour", and a zero here would be a division
            // waiting to happen.
            'rostered_seconds_this_week' => $this->duty->rosteredSecondsIn(
                (int) $driver->getKey(),
                $weekStart,
                $weekEnd,
            ),

            /*
             * The weekly bonus card, and the *Trips this week* dial's ceiling.
             *
             * **`progressFor()` is the Promotions agent's, and is reused
             * rather than reimplemented** — it landed in `WeeklyBonusService`
             * while this was being written, on top of the `currentWeek()` and
             * `tripsInWeek()` helpers added here, and it answers this question
             * more completely than the block it replaced: it also carries
             * `ends_at` and a server-computed `achieved`. Two implementations
             * of "how is this driver doing against the bonus" is one that
             * gains a `>=` and one that keeps a `>`, on a screen about money.
             *
             * **Null when the scheme is off, and the app draws neither the
             * card nor the dial's arc.** A card reading "0 of 40 trips" for a
             * fleet that runs no bonus scheme is an invented figure dressed as
             * a measurement (`docs/screen-rules.md` §1), and an arc against a
             * target nobody set is the same error drawn as a shape.
             */
            'bonus' => $this->bonuses->progressFor($driver, $now),
        ];
    }
}
