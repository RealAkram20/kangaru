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
    public function __construct(private readonly SettingsService $settings) {}

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
                'amount_minor' => -$fare,
                'currency' => $currency,
                'description' => "Cash taken on trip #{$trip->getKey()}; {$commission} of it is commission at {$percent}%",
            ]);

            return true;
        });
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
