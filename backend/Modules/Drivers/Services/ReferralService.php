<?php

namespace Modules\Drivers\Services;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverReferral;
use Modules\Trips\Enums\TripStatus;

/**
 * A driver introduces another driver, and is paid when that person works
 * (ADR-0037).
 *
 * ## Why the reward is delayed rather than paid at sign-up
 *
 * A sign-up costs nothing to manufacture. A driver who has completed
 * `billing.referral_trip_target` real trips has been dispatched real work,
 * carried real passengers and produced real fares the platform priced — so
 * the target is not a hurdle placed in front of the reward, it *is* the
 * verification. Paying on approval instead would make the scheme's cost
 * proportional to how many names somebody could get past the office.
 *
 * ## The fraud model, in one paragraph
 *
 * **A human approves every application** (ADR-0027), and that is the control.
 * Underneath it the schema removes the two attacks that do not need a person
 * to be fooled: `driver_referrals.referred_driver_id` is unique, so nobody is
 * introduced twice, and a code is resolved to an *existing* driver at approval
 * — so a referrer must already have been approved themselves. Cycles are
 * therefore structurally impossible rather than checked for: a driver cannot
 * introduce somebody who introduced them, because the second of the two did
 * not exist when the first applied. Self-referral is refused explicitly
 * anyway, because it costs one comparison and the alternative is trusting an
 * argument.
 *
 * ## What this class never does
 *
 * **It never tells anybody whether a code is real.** `attach()` returns null
 * for a code that resolves to nothing, and the approval carries on. Answering
 * "that code is not one of ours" to an unauthenticated applicant would be the
 * same leak ADR-0027 §5 refuses for the email address — a way of asking which
 * codes exist, one guess at a time.
 */
class ReferralService
{
    /**
     * The alphabet a code is drawn from.
     *
     * No `O`, `0`, `I`, `1` or `L`. A referral code is read aloud across a
     * table in a depot and typed into a phone by somebody who has never seen
     * it written down, and those five characters are where that goes wrong.
     * Uppercase only, for the same reason.
     */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    private const CODE_LENGTH = 8;

    /**
     * No `DriverEarningsService` here, unlike its two sibling schemes.
     *
     * A referral has **no window and no period** — a target of ten trips is
     * the same ten trips whatever timezone the fleet keeps, and the count runs
     * over the referred driver's whole history rather than a day or a week.
     * `WeeklyBonusService` and `PeakHoursService` both need the fleet's zone
     * because both are bounded in time; this is not, and injecting it "for
     * consistency" would be a dependency nothing reads.
     */
    public function __construct(
        private readonly SettingsService $settings,
        private readonly DriverLedgerService $ledger,
    ) {}

    /** Whether the operator has switched the scheme on at all. */
    public function enabled(): bool
    {
        return (bool) $this->settings->get('billing', 'referral_enabled');
    }

    public function tripTarget(): int
    {
        return (int) $this->settings->get('billing', 'referral_trip_target');
    }

    public function rewardMinor(): int
    {
        return (int) $this->settings->get('billing', 'referral_reward_amount_minor');
    }

    /**
     * This driver's code, minted on first use.
     *
     * On demand rather than at driver creation, so every driver who existed
     * before ADR-0037 does not need backfilling and a code nobody has looked
     * at is not a string occupying a unique index.
     *
     * **The uniqueness guard is the index, not the loop.** The retry exists to
     * survive a collision; it is `drivers.referral_code`'s unique constraint
     * that makes two drivers sharing a code impossible, and a pre-flight
     * `exists()` check would leave a race between two concurrent mints — the
     * same argument `WeeklyBonusService::award()` makes for catching the
     * violation rather than looking before it.
     */
    public function codeFor(Driver $driver): string
    {
        $existing = $driver->referral_code;

        if (is_string($existing) && $existing !== '') {
            return $existing;
        }

        // 31^8 is about 850 billion, so a collision is not the expected case;
        // five attempts is a bound on a pathological one rather than a
        // strategy. Exhausting them throws, which is correct — a driver
        // handed a code somebody else owns is worse than a driver handed an
        // error.
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $code = $this->mint();

            try {
                $driver->forceFill(['referral_code' => $code])->save();

                return $code;
            } catch (QueryException $e) {
                if ($e->getCode() !== '23000') {
                    throw $e;
                }
            }
        }

        throw new \RuntimeException('Could not mint a unique referral code after five attempts.');
    }

    /**
     * Records that `$referred` was introduced with `$code`, if it resolves.
     *
     * Called from inside `DriverApplicationService::approve()`'s transaction,
     * so a referral and the driver it concerns are written together or not at
     * all.
     *
     * **Returns null, silently, in four cases** — the scheme is off, no code
     * was given, the code resolves to nobody, or it resolves to the referred
     * driver themselves. None of them is an error the reviewer should be
     * stopped by: they are approving a driver, and a mistyped code is not a
     * reason to refuse somebody a job.
     */
    public function attach(Driver $referred, ?string $code): ?DriverReferral
    {
        if (! $this->enabled()) {
            return null;
        }

        $normalised = $this->normalise($code);

        if ($normalised === null) {
            return null;
        }

        $referrer = Driver::query()->where('referral_code', $normalised)->first();

        if ($referrer === null) {
            return null;
        }

        // Cheap, and it does not rely on the structural argument in the class
        // docblock holding for every future path into this method.
        if ($referrer->getKey() === $referred->getKey()) {
            return null;
        }

        try {
            return DriverReferral::create([
                'referrer_driver_id' => $referrer->getKey(),
                'referred_driver_id' => $referred->getKey(),
                // Frozen. The referrer may be issued a new code tomorrow and
                // this row must still say which one was used.
                'code' => $normalised,
                'trip_target' => $this->tripTarget(),
                'amount_minor' => $this->rewardMinor(),
                'currency' => $this->currency(),
            ]);
        } catch (QueryException $e) {
            // 23000 here means `referred_driver_id` is taken: this person has
            // already been introduced by somebody. The first referral stands
            // — see the class docblock — and the approval carries on.
            if ($e->getCode() === '23000') {
                return null;
            }

            throw $e;
        }
    }

    /**
     * Pays the referrer if `$referred` has now cleared their target.
     *
     * Called after a trip completes. **It counts trips rather than trusting a
     * counter**, because the count is the thing the reward is owed against and
     * an increment that ran twice — an outbox retry, a re-fired event — would
     * pay early.
     *
     * **The lock is what makes this idempotent.** Two completions landing at
     * once would both read `qualified_at` as null and both pay; taking the row
     * `lockForUpdate` inside the transaction turns the second into a no-op.
     * The `referred_driver_id` unique index cannot help here — it stops a
     * second *referral*, not a second payment against one.
     *
     * @return bool whether a reward was written
     */
    public function qualify(Driver $referred): bool
    {
        if (! $this->enabled()) {
            return false;
        }

        return DB::transaction(function () use ($referred) {
            $referral = DriverReferral::query()
                ->where('referred_driver_id', $referred->getKey())
                ->whereNull('qualified_at')
                ->lockForUpdate()
                ->first();

            if ($referral === null) {
                return false;
            }

            if ($this->completedTrips($referred) < $referral->trip_target) {
                return false;
            }

            $referrer = Driver::query()->find($referral->referrer_driver_id);

            if ($referrer === null) {
                return false;
            }

            // Zero is a legitimate setting and it means "run the scheme but
            // pay nothing", which is not a thing to write a ledger row for.
            if ($referral->amount_minor < 1) {
                return false;
            }

            // The referred driver is **not named**. A wallet statement is
            // permanent and scrollable, and ADR-0024 §7's principle — a
            // person's details are released for the moment that needs them,
            // not for ever — applies to a colleague as much as to a
            // passenger. Both frozen figures go into the sentence for
            // ADR-0029 §3's reason.
            $description = sprintf(
                'Referral reward: a driver you introduced completed %d trips',
                $referral->trip_target,
            );

            $entry = $this->ledger->recordReferral(
                $referrer,
                $referral->amount_minor,
                $referral->currency,
                $description,
            );

            $referral->forceFill([
                'qualified_at' => now(),
                'ledger_entry_id' => $entry->getKey(),
            ])->save();

            return true;
        });
    }

    /**
     * How many people this driver has introduced, and how they are getting on.
     *
     * One grouped query rather than two counts, because the Promotions screen
     * draws both halves and a screen is not a reason to make two round trips.
     *
     * @return array{introduced: int, qualified: int, earned_minor: int}
     */
    public function progressFor(Driver $referrer): array
    {
        $rows = DriverReferral::query()
            ->where('referrer_driver_id', $referrer->getKey())
            ->get(['qualified_at', 'amount_minor']);

        $qualified = 0;
        $earned = 0;

        foreach ($rows as $row) {
            if ($row->qualified_at !== null) {
                $qualified++;
                $earned += $row->amount_minor;
            }
        }

        return [
            'introduced' => $rows->count(),
            'qualified' => $qualified,
            // Summed from the **frozen** amounts on the rows, never from the
            // current setting times the count: a driver who earned two
            // rewards at 10,000 is owed 20,000 after the office moves the
            // figure to 15,000, and multiplying would restate history.
            'earned_minor' => $earned,
        ];
    }

    /**
     * The referred driver's completed trips.
     *
     * `Trip` is `BelongsToTenant` and a driver's walk-in work has no tenant,
     * so a plain Eloquent count would silently return a *plausible,
     * incomplete* number — `TenantScope` fails closed. Counted through the
     * query builder for the same reason `WeeklyBonusService` does, which
     * bypasses the scope entirely rather than opting out of it.
     */
    private function completedTrips(Driver $referred): int
    {
        return (int) DB::table('trips')
            ->where('driver_id', $referred->getKey())
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->whereNotNull('completed_at')
            ->count();
    }

    /**
     * Uppercased and stripped of the punctuation people add when they read a
     * code off a screen — spaces and hyphens, mostly.
     *
     * Returns null for anything that is not then a plausible code, so an empty
     * field and a field full of spaces reach `attach()` as the same thing.
     */
    private function normalise(?string $code): ?string
    {
        if ($code === null) {
            return null;
        }

        $clean = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');

        return $clean === '' || strlen($clean) > 16 ? null : $clean;
    }

    private function mint(): string
    {
        $code = '';
        $max = strlen(self::ALPHABET) - 1;

        for ($i = 0; $i < self::CODE_LENGTH; $i++) {
            // `random_int`, not `rand`. A guessable referral code is a way of
            // attributing your own recruits to somebody else's account, and
            // this costs nothing over the weaker call.
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return $code;
    }

    /**
     * What a reward is denominated in.
     *
     * The configured regional currency, because a referral reward is the
     * platform's own money going out — there is no trip to read a currency
     * off. `WeeklyBonusService` says the same thing for the same reason:
     * hardcoding `UGX` is the first thing that breaks in a second market.
     */
    private function currency(): string
    {
        $configured = $this->settings->get('regional', 'currency');

        return is_string($configured) && $configured !== '' ? $configured : 'UGX';
    }
}
