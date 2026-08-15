<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverWeeklyBonus;
use Modules\Trips\Enums\TripStatus;

/**
 * The weekly target bonus (ADR-0034 §4).
 *
 * A driver who completed at least `billing.bonus_weekly_trip_target` trips in
 * a calendar week is credited `billing.bonus_weekly_amount_minor`.
 *
 * ## Three things this refuses to do, each for a stated reason
 *
 * **It never runs on the current week.** A partial week cannot be measured
 * against a weekly target, and a driver shown a bonus that later un-awards
 * itself has been lied to about money. `awardFor()` takes the week to close
 * and the caller is a command that passes *last* week.
 *
 * **It never reads the target from anywhere but settings.** The audit agent's
 * finding 5: a threshold that lives in a constant, or worse in a handset, goes
 * on asserting the old number after the office changes it. The driver app is
 * told neither figure — it reads the award that happened.
 *
 * **It does nothing at all while `billing.bonus_enabled` is false**, which is
 * the default. A scheme that switches itself on at deploy is an unbudgeted
 * liability against every driver on the platform.
 *
 * ## The week is the fleet's week
 *
 * Boundaries come from `DriverEarningsService::timezone()`, which is the one
 * place that resolves `settings.regional.timezone`. `config/app.php` is UTC,
 * and a Kampala week measured in UTC starts on Sunday at 03:00 — so two
 * evenings of work would fall into the wrong week, invisibly, with every
 * figure still looking plausible. That exact bug has been fixed twice in this
 * module already.
 */
class WeeklyBonusService
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly DriverEarningsService $earnings,
        private readonly DriverLedgerService $ledger,
    ) {}

    /** Whether the operator has switched the scheme on at all. */
    public function enabled(): bool
    {
        return (bool) $this->settings->get('billing', 'bonus_enabled');
    }

    public function tripTarget(): int
    {
        return (int) $this->settings->get('billing', 'bonus_weekly_trip_target');
    }

    public function amountMinor(): int
    {
        return (int) $this->settings->get('billing', 'bonus_weekly_amount_minor');
    }

    /**
     * The Monday of the week before the one containing `$at`.
     *
     * The command's default, pulled out so the boundary arithmetic is stated
     * once and can be tested without a clock.
     */
    public function lastClosedWeek(?CarbonImmutable $at = null): CarbonImmutable
    {
        $timezone = $this->earnings->timezone();
        $now = $at?->setTimezone($timezone) ?? CarbonImmutable::now($timezone);

        return $now->startOfWeek()->subWeek()->startOfDay();
    }

    /**
     * Awards every driver who cleared the target in the week beginning
     * `$weekStart`.
     *
     * @return int how many bonuses were written
     */
    public function awardFor(CarbonImmutable $weekStart): int
    {
        if (! $this->enabled()) {
            return 0;
        }

        $target = $this->tripTarget();
        $amount = $this->amountMinor();

        // A target of zero would pay every driver on the platform, including
        // those who did not work. Guarded rather than trusted to validation:
        // the settings rule allows a minimum of 1, and this is the code that
        // would spend the money if it ever did not.
        if ($target < 1 || $amount < 1) {
            return 0;
        }

        $timezone = $this->earnings->timezone();
        $from = $weekStart->setTimezone($timezone)->startOfDay();
        $to = $from->addWeek();

        $counts = $this->completedTripsPerDriver($from, $to);
        $currency = $this->currency();
        $awarded = 0;

        foreach ($counts as $driverId => $trips) {
            if ($trips < $target) {
                continue;
            }

            $driver = Driver::query()->find($driverId);

            if ($driver === null) {
                continue;
            }

            if ($this->award($driver, $from, $trips, $target, $amount, $currency)) {
                $awarded++;
            }
        }

        return $awarded;
    }

    /**
     * Writes one driver's bonus, or returns false if they already had it.
     *
     * **The unique index is the guard, and the catch is how it is used.** A
     * pre-flight `exists()` check leaves a race between two concurrent runs;
     * letting the insert fail and treating the violation as "already awarded"
     * cannot. That is the same reasoning `DriverLedgerService::
     * recordCompletedTrip()` gives for its own `(trip_id, kind)` index — the
     * lock turns a race into a no-op, and the index is what makes it true.
     */
    private function award(
        Driver $driver,
        CarbonImmutable $weekStart,
        int $trips,
        int $target,
        int $amount,
        string $currency,
    ): bool {
        try {
            return DB::transaction(function () use ($driver, $weekStart, $trips, $target, $amount, $currency) {
                // Both figures go into the sentence, because both are
                // admin-settable and an award explained only by "the current
                // target" is one nobody can defend a year later.
                $description = sprintf(
                    'Weekly bonus for the week of %s: %d trips against a target of %d',
                    $weekStart->format('j M Y'),
                    $trips,
                    $target,
                );

                $entry = $this->ledger->recordBonus($driver, $amount, $currency, $description);

                DriverWeeklyBonus::create([
                    'driver_id' => $driver->getKey(),
                    'week_start' => $weekStart->toDateString(),
                    'trips_completed' => $trips,
                    'trip_target' => $target,
                    'amount_minor' => $amount,
                    'currency' => $currency,
                    'ledger_entry_id' => $entry->getKey(),
                ]);

                return true;
            });
        } catch (QueryException $e) {
            // 23000 is an integrity constraint violation, which here means
            // exactly one thing: this driver already has a row for this week.
            // Anything else is a real failure and must not be swallowed —
            // a bonus run that quietly ate a connection error would report
            // "0 awarded" and look like a quiet week.
            if ($e->getCode() === '23000') {
                return false;
            }

            throw $e;
        }
    }

    /**
     * Completed trips per driver in the window.
     *
     * `completed_at`, not `created_at`: the week a trip *finished* in is the
     * week it counts towards, and a job dispatched on Sunday night and
     * finished on Monday belongs to the new week from the driver's point of
     * view as much as from the ledger's.
     *
     * `->utc()` on both bounds for the reason `DriverEarningsService::
     * entries()` sets out at length: Laravel *formats* a bound Carbon in its
     * own timezone rather than converting it, so an unconverted `+03:00`
     * boundary silently shifts the window by three hours.
     *
     * @return array<int, int> driver id => completed trips
     */
    private function completedTripsPerDriver(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $rows = DB::table('trips')
            ->select('driver_id')
            ->selectRaw('COUNT(*) as completed')
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', $from->utc())
            ->where('completed_at', '<', $to->utc())
            ->groupBy('driver_id')
            ->get();

        $counts = [];

        foreach ($rows as $row) {
            /** @var object{driver_id: int|null, completed: int|string} $row */
            if ($row->driver_id !== null) {
                $counts[(int) $row->driver_id] = (int) $row->completed;
            }
        }

        return $counts;
    }

    /**
     * What the bonus is denominated in.
     *
     * The configured regional currency, because a bonus is the platform's own
     * money going out rather than a share of a fare somebody paid — there is
     * no trip to read a currency off. AGENTS.md's money rules pair every
     * amount with its ISO 4217 code, and hardcoding `UGX` is the first thing
     * that breaks in a second market.
     */
    private function currency(): string
    {
        $configured = $this->settings->get('regional', 'currency');

        return is_string($configured) && $configured !== '' ? $configured : 'UGX';
    }
}
