<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverWeeklyBonus;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailMoney;
use Modules\Notifications\Notifications\DriverEventNotification;
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
        return $this->currentWeek($at)->subWeek();
    }

    /**
     * The Monday of the week containing `$at`, in the fleet's timezone.
     *
     * The week **in progress** — which `awardFor()` must never be handed, and
     * which the Performance screen's progress card is entirely about. The two
     * uses are opposite and both are legitimate: nothing is paid for a partial
     * week, and a driver is still owed a truthful count of where they are in
     * one.
     */
    public function currentWeek(?CarbonImmutable $at = null): CarbonImmutable
    {
        $timezone = $this->earnings->timezone();
        $now = $at?->setTimezone($timezone) ?? CarbonImmutable::now($timezone);

        return $now->startOfWeek()->startOfDay();
    }

    /**
     * Completed trips for one driver in the week beginning `$weekStart`.
     *
     * **The same counting rule the award uses**, reached through the same
     * private query — deliberately, because this number is shown to a driver
     * as progress towards a payment. A screen that counted trips even
     * slightly differently from the command that pays out would eventually
     * tell somebody they had hit the target and then not pay them, and no
     * amount of explaining recovers from that.
     */
    public function tripsInWeek(int $driverId, CarbonImmutable $weekStart): int
    {
        $timezone = $this->earnings->timezone();
        $from = $weekStart->setTimezone($timezone)->startOfDay();

        return $this->completedTripsPerDriver($from, $from->addWeek(), $driverId)[$driverId] ?? 0;
    }

    /**
     * How this driver is doing against the target, in the week now running
     * (ADR-0036 §1 — the Promotions screen).
     *
     * **This is the "bonus preview" ADR-0034 deliberately did not build**, and
     * the objection it raised is answered rather than overruled. That entry
     * refused to let the *handset* state the target or the amount, because a
     * figure shipped inside an app goes on asserting the old number after the
     * office changes it. Every figure here is read from settings at request
     * time and computed on the server; the app is told what *is*, never the
     * rule that produced it, and an office that moves the target moves this
     * with it on the next pull.
     *
     * **It reports the open week, and says so.** The award still only ever
     * runs over a closed week — nothing about `awardFor()` changes, and a
     * driver at 18 of 30 has earned nothing yet. `ends_at` is served so the
     * screen can say when the question gets answered rather than implying it
     * already has.
     *
     * Null when the scheme is off, which is the caller's cue to draw nothing.
     * A card reading "0 of 40 trips" for a fleet that runs no bonus scheme is
     * the invented figure `docs/screen-rules.md` §1 forbids, dressed as a
     * measurement.
     *
     * @return array{
     *     trips: int,
     *     trip_target: int,
     *     amount_minor: int,
     *     currency: string,
     *     week_start: string,
     *     ends_at: string,
     *     achieved: bool
     * }|null
     */
    public function progressFor(Driver $driver, ?CarbonImmutable $at = null): ?array
    {
        if (! $this->enabled()) {
            return null;
        }

        $target = $this->tripTarget();
        $amount = $this->amountMinor();

        if ($target < 1 || $amount < 1) {
            return null;
        }

        // The week *containing* now, not the last closed one — and both the
        // boundary and the count go through the helpers above rather than
        // being derived here. `tripsInWeek()` reaches the same private query
        // the award uses, which is the point: a screen that counted trips even
        // slightly differently from the command that pays out would eventually
        // tell somebody they had hit the target and then not pay them.
        $from = $this->currentWeek($at);
        $to = $from->addWeek();

        $trips = $this->tripsInWeek((int) $driver->getKey(), $from);

        return [
            'trips' => $trips,
            'trip_target' => $target,
            'amount_minor' => $amount,
            'currency' => $this->currency(),
            'week_start' => $from->toIso8601String(),
            // When the week closes and the command can run — not when the
            // money arrives. The screen's wording carries that distinction.
            'ends_at' => $to->toIso8601String(),
            // Served rather than left to the app to derive from `trips >=
            // trip_target`. Two implementations of one comparison is one that
            // gains a `>` and one that does not.
            'achieved' => $trips >= $target,
        ];
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

                /*
                 * Money arriving unannounced (mail plan D12).
                 *
                 * This is the one driver email that carries good news, and it
                 * is worth sending for a reason beyond courtesy: a bonus that
                 * lands on a balance with nothing said is a bonus the driver
                 * does not know the target is reachable. The figures are in
                 * the fact block because the target is admin-settable, and an
                 * award explained only by "you hit the target" is one nobody
                 * can check.
                 */
                $driver->user?->notify(new DriverEventNotification(
                    NotificationType::DRIVER_WEEKLY_BONUS_AWARDED,
                    [
                        __('mail.driver.fact_amount') => MailMoney::format($amount, $currency),
                        __('mail.driver.fact_week') => $weekStart->isoFormat('D MMMM YYYY'),
                        __('mail.driver.fact_trips') => $trips.' / '.$target,
                    ],
                ));

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
     * `$onlyDriverId` narrows it to one driver for `tripsInWeek()`. The filter
     * is a parameter rather than a second query so the *predicate* — which
     * status, which timestamp, which half-open bound — is written once. It is
     * the rule that decides whether somebody gets paid.
     *
     * @return array<int, int> driver id => completed trips
     */
    private function completedTripsPerDriver(CarbonImmutable $from, CarbonImmutable $to, ?int $onlyDriverId = null): array
    {
        $rows = DB::table('trips')
            ->select('driver_id')
            ->selectRaw('COUNT(*) as completed')
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', $from->utc())
            ->where('completed_at', '<', $to->utc())
            ->when($onlyDriverId !== null, fn ($q) => $q->where('driver_id', $onlyDriverId))
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
