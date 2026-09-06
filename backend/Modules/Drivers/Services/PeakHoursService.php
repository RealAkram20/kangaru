<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;

/**
 * The peak-hour earnings uplift (ADR-0036).
 *
 * A trip completed inside a daily window earns the driver a percentage on top
 * of their ordinary share of the fare. **Nothing here changes what a passenger
 * pays** — the tariff is untouched and the uplift is the platform's own money,
 * which is what separates this from the night multiplier on a rate card.
 *
 * ## Three things it refuses to do, each for a stated reason
 *
 * **It never states the window to the handset as a rule.** The driver app is
 * told the resolved window for a given day, in ISO instants the server
 * computed — never `peak_starts_at` to be re-interpreted locally. The audit
 * agent's finding 5: a threshold shipped inside a handset goes on asserting
 * the old number after the office changes it, on devices nobody can reach.
 *
 * **It does nothing at all while `billing.peak_enabled` is false**, which is
 * the default. `WeeklyBonusService` gives the argument and this scheme needs
 * it more: a weekly bonus bills once a week, an uplift bills on every trip.
 *
 * **It never reads the clock to decide whether a trip qualified.** The
 * decision is made against `completed_at` and nothing else, so a ledger write
 * retried by the offline outbox (ADR-0023) an hour later reaches the same
 * answer as the first attempt. A rule that consulted "now" would pay
 * differently depending on when the network came back.
 *
 * ## The window is the fleet's window
 *
 * Boundaries resolve against `DriverEarningsService::timezone()`, which is the
 * one place that reads `settings.regional.timezone`. `config/app.php` is UTC,
 * and "17:00 to 20:00" measured in UTC is a window three hours out of step
 * with the driver it is meant to reward. That exact bug has been fixed twice
 * in this module already.
 */
class PeakHoursService
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly DriverEarningsService $earnings,
    ) {}

    /** Whether the operator has switched the scheme on at all. */
    public function enabled(): bool
    {
        return (bool) $this->settings->get('billing', 'peak_enabled');
    }

    /** The uplift as a percentage of the driver's share. */
    public function upliftPercent(): int
    {
        return (int) $this->settings->get('billing', 'peak_uplift_percent');
    }

    /** `HH:MM`, in the fleet's timezone. */
    public function startsAt(): string
    {
        return $this->time('peak_starts_at', '17:00');
    }

    public function endsAt(): string
    {
        return $this->time('peak_ends_at', '20:00');
    }

    /**
     * Whether an instant falls inside the window.
     *
     * **Transcribed from `TripPricingEngine::multiplierFor()`**, which answers
     * the same question about a rate card's night rate, down to the
     * lexicographic comparison: `HH:MM:SS` strings order correctly as strings,
     * so a time-of-day question needs no date arithmetic.
     *
     * A window that wraps midnight is the normal case rather than a
     * misconfiguration — 22:00 to 02:00 is a plausible peak in a nightlife
     * district — so it is handled explicitly.
     *
     * Half open at the top: a trip completed at exactly `peak_ends_at` is
     * outside. The alternative makes a one-second overlap between a window
     * ending and the next beginning, which is the kind of boundary nobody
     * tests and everybody eventually hits.
     */
    public function activeAt(CarbonImmutable $at): bool
    {
        if (! $this->enabled()) {
            return false;
        }

        $local = $at->setTimezone($this->earnings->timezone())->format('H:i');

        $from = $this->startsAt();
        $until = $this->endsAt();

        // Equal bounds are an empty window, not a whole day. An operator who
        // sets both to 17:00 has described no window at all, and reading it as
        // "always" would pay the uplift on every trip on the platform.
        if ($from === $until) {
            return false;
        }

        return $from < $until
            ? ($local >= $from && $local < $until)
            : ($local >= $from || $local < $until);
    }

    /**
     * What to add to a driver's share, in minor units.
     *
     * `intdiv` floors, matching every other money split in this module: the
     * fraction of a shilling lands with the driver rather than the platform.
     * `DriverLedgerService::recordCompletedTrip()` states the argument — a
     * house that rounds against itself is a house nobody has to audit for
     * rounding.
     *
     * Zero is a legitimate answer and is the caller's cue to write nothing: a
     * `peak_earned` row of 0 is a line on somebody's statement that says
     * nothing happened.
     */
    public function upliftMinorFor(int $shareMinor): int
    {
        if ($shareMinor <= 0) {
            return 0;
        }

        return intdiv($shareMinor * $this->upliftPercent(), 100);
    }

    /**
     * The window as two instants on the day containing `$at`, for the
     * Promotions screen.
     *
     * Returned as ISO strings so the app renders a *time the server resolved*
     * rather than re-deriving one from `HH:MM` and a timezone name — the same
     * reason `DriverEarningsService` serves `timezone` alongside its buckets.
     *
     * **A wrapping window is reported as ending on the following day**, which
     * is what it does. Reporting 22:00–02:00 as ending before it starts would
     * be a sentence the screen cannot render honestly.
     *
     * @return array{starts_at: string, ends_at: string, active: bool}|null
     *                                                                      null when the scheme is off, which is the caller's cue to draw nothing
     */
    public function windowOn(CarbonImmutable $at): ?array
    {
        if (! $this->enabled()) {
            return null;
        }

        $from = $this->startsAt();
        $until = $this->endsAt();

        if ($from === $until) {
            return null;
        }

        $local = $at->setTimezone($this->earnings->timezone());

        [$startHour, $startMinute] = array_map('intval', explode(':', $from));
        [$endHour, $endMinute] = array_map('intval', explode(':', $until));

        $starts = $local->setTime($startHour, $startMinute);
        $ends = $local->setTime($endHour, $endMinute);

        if ($from > $until) {
            $ends = $ends->addDay();
        }

        return [
            'starts_at' => $starts->toIso8601String(),
            'ends_at' => $ends->toIso8601String(),
            'active' => $this->activeAt($at),
        ];
    }

    /**
     * A settings time, defended against a malformed stored value.
     *
     * The validation rules make `HH:MM` a requirement, but this reads a row
     * somebody could have written before those rules existed — and a bad value
     * here does not throw, it silently widens or narrows the window that
     * spends the money.
     */
    private function time(string $key, string $fallback): string
    {
        $configured = $this->settings->get('billing', $key);

        return is_string($configured) && preg_match('/^\d{2}:\d{2}$/', $configured) === 1
            ? $configured
            : $fallback;
    }
}
