<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Trips\Models\Trip;

/**
 * A driver's money, as a list of things that happened (ADR-0029).
 *
 * Every method here either appends an entry or sums them. Nothing updates a
 * row, because the whole value of a ledger over a balance column is that a
 * driver disputing their pay can be shown the working.
 */
class DriverLedgerService
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly PeakHoursService $peak,
    ) {}

    /**
     * Raises the fare/commission pair for a completed trip.
     *
     * Idempotent, and it has to be: trip completion can be retried by the
     * app's offline outbox (ADR-0023), and paying a driver twice for one
     * journey is the kind of error nobody notices until reconciliation.
     * The `(trip_id, kind)` unique index is the real guard; this check just
     * turns a race into a no-op instead of an integrity violation.
     *
     * @return bool whether entries were written
     */
    public function recordCompletedTrip(Trip $trip): bool
    {
        // Only fares the platform actually priced (ADR-0029 §4). A corporate
        // trip is invoiced to the client and carries none; inventing one
        // would double-bill them.
        //
        // No `driver_id === null` clause: `trips.driver_id` is NOT NULL in
        // both the migration and the live schema, so that arm was dead code
        // and Larastan level 8 refused it. A trip always has somebody to pay.
        if ($trip->fare_minor === null || $trip->fare_minor <= 0) {
            return false;
        }

        return DB::transaction(function () use ($trip) {
            $already = DriverLedgerEntry::query()
                ->where('trip_id', $trip->getKey())
                ->lockForUpdate()
                ->exists();

            if ($already) {
                return false;
            }

            $percent = (int) $this->settings->get('billing', 'driver_commission_percent');
            $fare = (int) $trip->fare_minor;
            // What the passenger actually handed over (ADR-0045 §5): the
            // provisional fare shown at the kerb when there was one, else the
            // settled fare. The driver's share is of what the trip was
            // worth; the cash is what was taken. When the two differ the
            // balance shows it — the driver holds the excess, or the office
            // owes the shortfall — instead of a ledger asserting cash that
            // never changed hands.
            $collected = (int) ($trip->fare_provisional_minor ?? $trip->fare_minor);

            // The house rounds against itself. `intdiv` floors, so a fraction
            // of a shilling lands with the driver rather than the platform —
            // the alternative is being short-changed by rounding they cannot
            // see.
            $commission = intdiv($fare * $percent, 100);
            $earned = $fare - $commission;

            $currency = (string) ($trip->fare_currency ?? 'UGX');

            // The rate is written into the description, not just applied
            // (ADR-0029 §3): changing the setting tomorrow must not restate
            // what this driver earned today.
            DriverLedgerEntry::create([
                'driver_id' => $trip->driver_id,
                'trip_id' => $trip->getKey(),
                'kind' => LedgerEntryKind::FARE_EARNED,
                'amount_minor' => $earned,
                'currency' => $currency,
                'description' => "Fare for trip #{$trip->getKey()} at {$percent}% commission",
            ]);

            // The other half, and the one that makes the balance mean
            // something: the passenger handed the driver the whole fare in
            // cash, so they are holding the platform's money until they
            // settle. Net of the credit above, the driver is left owing
            // exactly the commission.
            DriverLedgerEntry::create([
                'driver_id' => $trip->driver_id,
                'trip_id' => $trip->getKey(),
                'kind' => LedgerEntryKind::CASH_COLLECTED,
                'amount_minor' => -$collected,
                'currency' => $currency,
                'description' => $collected === $fare
                    ? "Cash taken on trip #{$trip->getKey()}; {$commission} of it is commission at {$percent}%"
                    : "Cash taken on trip #{$trip->getKey()} at the provisional fare of {$collected}; settled fare {$fare}, commission {$commission} at {$percent}%",
            ]);

            $this->recordPeakUplift($trip, $earned, $currency);

            return true;
        });
    }

    /**
     * The peak-hour uplift on a trip, if it completed inside the window
     * (ADR-0036 §3).
     *
     * **Written here rather than by a second listener**, and the reason is the
     * `(trip_id, kind)` unique index. That index is what stops a completion
     * retried through the offline outbox (ADR-0023) paying a driver twice, and
     * it only protects rows written inside the transaction the guard above
     * holds. A separate listener would have its own race with itself.
     *
     * **Decided on `completed_at`, never on the clock.** A ledger write that
     * consulted "now" would pay differently depending on when the network came
     * back, so a driver on a bad connection would be paid by their signal
     * rather than by their hours. Trips with no `completed_at` earn nothing:
     * the platform does not know when they finished, and
     * `docs/screen-rules.md` §1's rule against inventing a value applies to a
     * timestamp the money turns on as much as to a figure on a screen.
     *
     * **Unpaired, unlike the fare above.** No extra cash reached the driver's
     * hand — the passenger paid the ordinary tariff, and `CASH_COLLECTED`
     * already records all of it. This is the platform coming to owe them more,
     * so the balance moves by the whole of it.
     */
    private function recordPeakUplift(Trip $trip, int $earnedMinor, string $currency): void
    {
        $completedAt = $trip->completed_at;

        if ($completedAt === null) {
            return;
        }

        if (! $this->peak->activeAt($completedAt->toImmutable())) {
            return;
        }

        $uplift = $this->peak->upliftMinorFor($earnedMinor);

        // Zero is a legitimate outcome — a 1-shilling share at 20% floors to
        // nothing — and a row of 0 is a line on a statement that says nothing
        // happened.
        if ($uplift < 1) {
            return;
        }

        $percent = $this->peak->upliftPercent();
        $from = $this->peak->startsAt();
        $until = $this->peak->endsAt();

        DriverLedgerEntry::create([
            'driver_id' => $trip->driver_id,
            'trip_id' => $trip->getKey(),
            'kind' => LedgerEntryKind::PEAK_EARNED,
            'amount_minor' => $uplift,
            'currency' => $currency,
            // The rate *and* the window go into the sentence, for ADR-0029 §3's
            // reason: both are admin-settable, and an uplift explained only by
            // "the current peak hours" is one nobody can defend a year later.
            'description' => "Peak hours uplift on trip #{$trip->getKey()}: {$percent}% of the fare share, {$from}–{$until}",
        ]);
    }

    /**
     * Credits a referral reward to the driver who introduced somebody
     * (ADR-0037 §4).
     *
     * **Unpaired and trip-less.** Unpaired for `recordBonus()`'s reason — the
     * platform simply comes to owe it. Trip-less because the trips that earned
     * it belong to the *referred* driver, and hanging it off one of them would
     * file somebody else's journey under this driver's name on the Trips
     * History screen, which reads from `trip_id`.
     *
     * **No commission**, like a bonus: taking a cut of an advertised reward
     * would mean the figure the driver was shown and the figure they were paid
     * differ, which is the one thing an incentive must not do.
     *
     * Idempotency is the caller's, and it is a database guarantee rather than
     * a promise: `driver_referrals` carries a unique index on
     * `referred_driver_id`, and `ReferralService::qualify()` writes the reward
     * and stamps the row in one transaction.
     */
    public function recordReferral(
        Driver $driver,
        int $amountMinor,
        string $currency,
        string $description,
    ): DriverLedgerEntry {
        return DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::REFERRAL,
            'amount_minor' => abs($amountMinor),
            'currency' => $currency,
            // Null for `recordBonus()`'s reason: no human decided this one,
            // the rule did.
            'created_by_user_id' => null,
            'description' => $description,
        ]);
    }

    /**
     * Raises the pair for a tip the office has confirmed (ADR-0034 §3).
     *
     * **Deliberately the same shape as `recordCompletedTrip()` above**, and
     * that is the whole reason a tip was made commissionable rather than
     * given a table of its own: the driver's share is a credit, the gross is
     * cash in their hand, and the net of the two is exactly what they now owe.
     *
     * ```
     * tip 2,000 at 20%
     *   tip_earned          + 1,600
     *   tip_cash_collected  − 2,000
     *   ---------------------------
     *   balance               −  400
     * ```
     *
     * The rate is written into the description rather than merely applied —
     * ADR-0029 §3 — so an office that changes the percentage tomorrow cannot
     * restate what this driver kept today. Nothing here reads the rate back
     * out; the figures are what they were.
     *
     * **`intdiv` floors, so the fraction of a shilling lands with the
     * driver**, matching the fare path. A house that rounds against itself is
     * a house nobody has to audit for rounding.
     *
     * Idempotency is the caller's: `DriverSettlementRequestService::confirm()`
     * locks the request and returns early if it is no longer pending, which
     * is the same guard that stops a double-tap paying a settlement twice.
     * The `(trip_id, kind)` unique index is the backstop underneath it.
     *
     * @return array{0: DriverLedgerEntry, 1: DriverLedgerEntry} the credit, then the cash held
     */
    public function recordTip(
        Driver $driver,
        Trip $trip,
        int $grossMinor,
        string $currency,
        User $by,
        ?string $note,
    ): array {
        $percent = (int) $this->settings->get('billing', 'driver_commission_percent');

        $gross = abs($grossMinor);
        $commission = intdiv($gross * $percent, 100);
        $earned = $gross - $commission;

        // The passenger is never named, whatever a mockup says. ADR-0024 §7
        // releases contact details only while a trip is live, and a wallet
        // statement is permanent — ADR-0034 §6 spells this out. The trip
        // number identifies the tip; the person does not.
        $head = "Tip on trip #{$trip->getKey()} at {$percent}% commission";
        $trimmed = trim((string) $note);
        $description = $trimmed === '' ? $head : "{$head}: {$trimmed}";

        return DB::transaction(function () use (
            $driver, $trip, $gross, $earned, $commission, $percent, $currency, $by, $description,
        ) {
            $credit = DriverLedgerEntry::create([
                'driver_id' => $driver->getKey(),
                'trip_id' => $trip->getKey(),
                'kind' => LedgerEntryKind::TIP_EARNED,
                'amount_minor' => $earned,
                'currency' => $currency,
                'description' => $description,
                'created_by_user_id' => $by->getKey(),
            ]);

            $held = DriverLedgerEntry::create([
                'driver_id' => $driver->getKey(),
                'trip_id' => $trip->getKey(),
                'kind' => LedgerEntryKind::TIP_CASH_COLLECTED,
                'amount_minor' => -$gross,
                'currency' => $currency,
                'description' => "Tip taken in cash on trip #{$trip->getKey()}; {$commission} of it is commission at {$percent}%",
                'created_by_user_id' => $by->getKey(),
            ]);

            return [$credit, $held];
        });
    }

    /**
     * Credits a weekly target bonus (ADR-0034 §4).
     *
     * **Unpaired, unlike a tip**, and the difference is real rather than
     * stylistic: a tip is cash already in the driver's hand, so it needs the
     * negative half that says they are holding some of the platform's money.
     * A bonus is not in anybody's hand — the office simply comes to owe it —
     * so the balance moves by the whole amount and settles through the
     * ordinary cash handover.
     *
     * **No commission.** A bonus is already the platform's own money going
     * out; taking a cut of it would mean the advertised figure and the paid
     * figure differ, which is the one thing an incentive must not do.
     *
     * The target and the amount are written into the description because both
     * are admin-settable. A bonus explained only by "the current target" is a
     * bonus nobody can defend a year later — ADR-0029 §3's rule, applied to a
     * second kind of rate.
     */
    public function recordBonus(
        Driver $driver,
        int $amountMinor,
        string $currency,
        string $description,
        ?User $by = null,
    ): DriverLedgerEntry {
        return DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::BONUS,
            'amount_minor' => abs($amountMinor),
            'currency' => $currency,
            'description' => $description,
            // Null when the scheduled command awarded it, which is the
            // ordinary case: no human decided this one, the rule did.
            'created_by_user_id' => $by?->getKey(),
        ]);
    }

    /**
     * Records money that actually moved between the office and the driver.
     *
     * Signed by the caller, because it genuinely goes both ways: a boda
     * rider remitting the day's cash is **positive** (it reduces what they
     * owe), and a payment out to a driver the platform owes is negative.
     *
     * The platform records that money moved; it does not move it (ADR-0029
     * §6). Whoever hands over the cash writes this.
     */
    public function recordSettlement(Driver $driver, int $amountMinor, User $by, string $note): DriverLedgerEntry
    {
        return DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::SETTLEMENT,
            'amount_minor' => $amountMinor,
            'currency' => 'UGX',
            'description' => $note,
            'created_by_user_id' => $by->getKey(),
        ]);
    }

    /** What the office and the driver owe each other, net. */
    public function balanceMinor(Driver $driver): int
    {
        return (int) DriverLedgerEntry::query()
            ->where('driver_id', $driver->getKey())
            ->sum('amount_minor');
    }

    /**
     * The driver's own share of today's work — not the gross fare.
     *
     * Commission entries are excluded rather than netted: this answers "what
     * did I make today", and a driver reading it against their pocket wants
     * their half of the transaction, not the balance of both.
     */
    public function earnedSinceMinor(Driver $driver, Carbon $since): int
    {
        return (int) DriverLedgerEntry::query()
            ->where('driver_id', $driver->getKey())
            ->where('kind', LedgerEntryKind::FARE_EARNED->value)
            ->where('created_at', '>=', $since)
            ->sum('amount_minor');
    }
}
