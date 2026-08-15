<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\EarningsPeriod;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;

/**
 * What a driver earned over a day, a week or a month — the earnings screen.
 *
 * Everything here is read from `driver_ledger_entries`, which ADR-0029 makes
 * the single record of what a driver is owed. Nothing is recomputed from the
 * commission rate: the entries hold the driver's share **as it was written at
 * completion**, so a rate the office changes today cannot restate last week's
 * earnings (ADR-0029 §3).
 *
 * ## The four things the screen's mockup asked for that are not here
 *
 * - **Tips.** Do not exist on this platform. Not a column, not an
 *   `InvoiceLineType`, not a `LedgerEntryKind`, not a key in
 *   `order_requests.details`.
 * - **Bonuses.** Do not exist either — no bonus, incentive, surge, streak or
 *   target anywhere in the backend. The mockup printed `UGX 0`, which
 *   `docs/screen-rules.md` §1 forbids by name: a hard zero reads as "this
 *   platform pays no bonuses", which is a claim, where an absent row is not.
 * - **Online hours.** `driver_presence` is one row per driver, overwritten on
 *   every toggle — its migration argues for that deliberately, and the
 *   previous state is destroyed, so the history does not exist to be summed.
 *   `on_trip_minutes` below is offered instead and is **not** the same figure.
 * - **A settlement or payout action.** ADR-0029 §6 puts it out of scope.
 *
 * ## Why the total and the breakdown come from one row set
 *
 * `order_requests.trip_id` is a nullable foreign key with **no unique
 * constraint** — the `hasOne` is a model convention, not a database
 * guarantee. So a `LEFT JOIN` from the ledger to `order_requests` could
 * multiply a row and inflate the total, and
 * `FinancialActivityRepository` already records what that failure looks like:
 * *"on a financial aggregate it does not look like a duplicated row, it looks
 * like a larger figure."*
 *
 * The entries are therefore read **unjoined**, and service types are attached
 * afterwards from a second query keyed by trip. The total, the trend and the
 * breakdown are then all folds over that same one row set, which makes
 * *"the breakdown sums to the total"* true by construction rather than by
 * luck. A test pins it anyway, because that is the invariant a driver would
 * notice broken.
 */
class DriverEarningsService
{
    /**
     * The label for earnings that cannot be classified as a ride or a
     * delivery, because the trip behind them has no order request — a walk-in
     * a dispatcher fulfilled by hand.
     *
     * **It is a row rather than a silent omission.** Dropping unclassifiable
     * money would leave a breakdown that does not add up to the figure above
     * it, on a screen whose entire subject is a driver's pay.
     */
    public const UNCLASSIFIED = 'other';

    /**
     * The two rows that are a *kind* of earning rather than a kind of job
     * (ADR-0034).
     *
     * They share the `service_type` key with the real service types because
     * the breakdown is one list and a driver reads it as one list — but they
     * are grouped ahead of it in `breakdown()`, so a tip is never folded into
     * the "Rides" row of the trip it was given on.
     *
     * **The mockup's Bonuses row printed `UGX 0` and was refused** by
     * `docs/screen-rules.md` §1, because a hard zero for a feature that did
     * not exist reads as "this platform pays no bonuses". It exists now, so
     * the row is real — and it is still absent rather than zero for a driver
     * who earned none, which is the distinction that rule was drawing.
     */
    public const TIPS = 'tip';

    public const BONUSES = 'bonus';

    public function __construct(private readonly SettingsService $settings) {}

    /**
     * @return array{
     *     period: string,
     *     timezone: string,
     *     from: string,
     *     to: string,
     *     currency: string,
     *     total_minor: int,
     *     trips: int,
     *     on_trip_minutes: int|null,
     *     breakdown: list<array{service_type: string, trips: int, earned_minor: int}>,
     *     trend: list<array{bucket: string, earned_minor: int}>
     * }
     */
    public function forDriver(Driver $driver, EarningsPeriod $period): array
    {
        $timezone = $this->timezone();
        $now = CarbonImmutable::now($timezone);

        $from = $period->startsAt($now);
        $to = $period->endsAt($now);

        $entries = $this->entries($driver, $from, $to, $timezone);

        $tripIds = [];

        foreach ($entries as $entry) {
            if ($entry['trip_id'] !== null) {
                $tripIds[$entry['trip_id']] = true;
            }
        }

        $serviceTypes = $this->serviceTypesFor(array_keys($tripIds));

        return [
            'period' => $period->value,
            // Served, not assumed. The app renders "12 AM" against these
            // buckets and must not label them in the handset's own zone — a
            // driver crossing a border does not want their day to move.
            'timezone' => $timezone,
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'currency' => $this->currency($entries),
            'total_minor' => array_sum(array_column($entries, 'amount_minor')),
            'trips' => count($tripIds),
            'on_trip_minutes' => $this->onTripMinutes($driver, $from, $to),
            'breakdown' => $this->breakdown($entries, $serviceTypes),
            'trend' => $this->trend($entries, $period, $from, $to),
        ];
    }

    /**
     * The driver's `fare_earned` entries in the window, with local timestamps.
     *
     * `[$from, $to)` — half open, and deliberately. An inclusive `23:59:59`
     * upper bound drops every entry written in the final second of the
     * period, which is a rare, unreproducible and entirely silent way to lose
     * somebody's money.
     *
     * **The three credit kinds** — `fare_earned`, `tip_earned` and `bonus`
     * (ADR-0034). The set lives on `LedgerEntryKind::earnings()` rather than
     * as a list here, because the Trips History endpoint needs the same
     * answer and two hand-written copies of "which kinds are earnings" is one
     * copy that gains `tip_earned` and one that does not.
     *
     * **`cash_collected` and `tip_cash_collected` are deliberately absent.**
     * They are the negative counterparts that make the wallet *balance* work
     * (ADR-0029 §2), and summing them in would report a driver's earnings as
     * roughly minus the commission.
     *
     * Mapped straight into typed arrays rather than passed around as the
     * `stdClass` rows `DB::table` yields — Larastan level 8 cannot know what
     * is on those, and neither can the next reader.
     *
     * @return list<array{trip_id: int|null, kind: string, amount_minor: int, currency: string, local_at: CarbonImmutable}>
     */
    private function entries(
        Driver $driver,
        CarbonImmutable $from,
        CarbonImmutable $to,
        string $timezone,
    ): array {
        $rows = DB::table('driver_ledger_entries')
            // `kind` travels with the row because the breakdown groups on it:
            // a tip and a bonus are their own lines, not the service type of
            // whatever trip they happen to hang off (ADR-0034).
            ->select(['trip_id', 'kind', 'amount_minor', 'currency', 'created_at'])
            ->where('driver_id', $driver->getKey())
            ->whereIn('kind', LedgerEntryKind::earningsValues())
            // **`->utc()` is load-bearing, and leaving it off is a silent
            // wrong answer rather than an error.** Laravel binds a Carbon to
            // SQL by formatting it in *its own* timezone — it does not
            // convert — so a boundary of `2026-08-16 00:00+03:00` reaches the
            // database as the string `2026-08-16 00:00:00` and is compared
            // against a UTC column. The window silently becomes the UTC day,
            // three hours out, and every figure still looks plausible.
            //
            // This was caught by the two tests that cross a local midnight;
            // the tests that do not cross one passed *for the wrong reason*
            // before the fix, which is the whole argument for having them.
            ->where('created_at', '>=', $from->utc())
            ->where('created_at', '<', $to->utc())
            ->orderBy('created_at')
            ->get();

        $entries = [];

        foreach ($rows as $row) {
            /** @var object{trip_id: int|null, kind: string, amount_minor: int|string, currency: string|null, created_at: string} $row */
            $entries[] = [
                'trip_id' => $row->trip_id === null ? null : (int) $row->trip_id,
                'kind' => (string) $row->kind,
                'amount_minor' => (int) $row->amount_minor,
                'currency' => (string) ($row->currency ?? ''),
                'local_at' => CarbonImmutable::parse((string) $row->created_at, 'UTC')
                    ->setTimezone($timezone),
            ];
        }

        return $entries;
    }

    /**
     * Which of those trips were rides and which were deliveries.
     *
     * A second query rather than a join, for the fan-out reason in the class
     * docblock. `service_type` lives on `order_requests` and is indexed;
     * nothing has ever joined it to the ledger before this.
     *
     * `keyBy('trip_id')` keeps **one** row per trip even though the schema
     * permits several — last write wins, which is arbitrary but bounded, and
     * cannot affect any money figure because the amounts come from the
     * entries rather than from here.
     *
     * @param  list<int>  $tripIds
     * @return array<int, string>
     */
    private function serviceTypesFor(array $tripIds): array
    {
        if ($tripIds === []) {
            return [];
        }

        $rows = DB::table('order_requests')
            ->select(['trip_id', 'service_type'])
            ->whereIn('trip_id', $tripIds)
            ->get();

        $types = [];

        foreach ($rows as $row) {
            /** @var object{trip_id: int, service_type: string} $row */
            $types[(int) $row->trip_id] = (string) $row->service_type;
        }

        return $types;
    }

    /**
     * Earnings grouped by what kind of job produced them.
     *
     * Driven by the data rather than by a fixed list of rows: the platform
     * knows `ride`, `delivery` **and `self_drive`**, and a screen hardcoded to
     * the mockup's two would silently hide the third the day it is used.
     * Anything unclassifiable lands in `other` — see `UNCLASSIFIED`.
     *
     * Ordered by earnings, largest first, so the row that made a driver the
     * most money is the one they read first.
     *
     * @param  list<array{trip_id: int|null, kind: string, amount_minor: int, currency: string, local_at: CarbonImmutable}>  $entries
     * @param  array<int, string>  $serviceTypes
     * @return list<array{service_type: string, trips: int, earned_minor: int}>
     */
    private function breakdown(array $entries, array $serviceTypes): array
    {
        $rows = [];

        foreach ($entries as $entry) {
            $tripId = $entry['trip_id'];

            // **Kind first, service type second** (ADR-0034). A tip hangs off
            // a trip and would otherwise be filed under that trip's service
            // type — folding a gratuity into "Rides" and leaving the mockup's
            // Tips row permanently absent. A bonus has no trip at all and
            // would land in `other`, which reads as unclassifiable work rather
            // than as the thing it is.
            $type = match ($entry['kind']) {
                LedgerEntryKind::TIP_EARNED->value => self::TIPS,
                LedgerEntryKind::BONUS->value => self::BONUSES,
                default => ($tripId !== null && isset($serviceTypes[$tripId]))
                    ? $serviceTypes[$tripId]
                    : self::UNCLASSIFIED,
            };

            $rows[$type] ??= ['service_type' => $type, 'trips' => 0, 'earned_minor' => 0];
            $rows[$type]['trips']++;
            $rows[$type]['earned_minor'] += $entry['amount_minor'];
        }

        // `usort` reindexes, so the string-keyed map above comes back as the
        // list this returns. No `array_values` — it would be a no-op.
        usort($rows, fn (array $a, array $b) => $b['earned_minor'] <=> $a['earned_minor']);

        return $rows;
    }

    /**
     * The chart, as a continuous series with no gaps.
     *
     * **Zero-filled, and that is not the thing `docs/screen-rules.md` §1
     * forbids.** That rule bans a zero standing in for a figure the platform
     * does not have. An hour with no `fare_earned` entry is not unknown — the
     * ledger is written at completion, so no entry in an hour is positive
     * evidence that nothing was completed in it, and the driver earned
     * exactly nothing. Leaving it out would compress the axis and draw 3 AM
     * next to 7 PM as though the intervening hours had not happened.
     *
     * This is where it departs from `FinancialActivityRepository`, which emits
     * only buckets that have data — right for a table of periods, wrong for a
     * chart whose x-axis is time itself.
     *
     * @param  list<array{trip_id: int|null, kind: string, amount_minor: int, currency: string, local_at: CarbonImmutable}>  $entries
     * @return list<array{bucket: string, earned_minor: int}>
     */
    private function trend(
        array $entries,
        EarningsPeriod $period,
        CarbonImmutable $from,
        CarbonImmutable $to,
    ): array {
        $bucket = $period->bucket();

        $earned = [];

        foreach ($entries as $entry) {
            $key = $bucket->keyFor($entry['local_at']);
            $earned[$key] = ($earned[$key] ?? 0) + $entry['amount_minor'];
        }

        $points = [];

        for ($at = $from; $at < $to; $at = $bucket->advance($at)) {
            $key = $bucket->keyFor($at);
            $points[] = ['bucket' => $key, 'earned_minor' => $earned[$key] ?? 0];
        }

        return $points;
    }

    /**
     * Minutes spent on trips in the window — **not** hours spent online.
     *
     * The mockup wanted "Online hours" and this platform cannot produce it:
     * `driver_presence` holds one row per driver and overwrites it on every
     * duty toggle, so the history was never kept. This is the honest
     * neighbour — time actually driving, measured from the two timestamps the
     * state machine writes — and the screen labels it as such. A driver
     * waiting an hour for an offer is not counted, and must not be told they
     * were.
     *
     * Null rather than zero when no trip in the window has both timestamps: a
     * driver whose trips are all still running has no figure yet, and `0m`
     * beside a non-zero earnings total is a contradiction a screen should not
     * print.
     *
     * Summed in SQL over `trips`, not derived from the ledger, because the
     * ledger has no notion of duration.
     */
    private function onTripMinutes(Driver $driver, CarbonImmutable $from, CarbonImmutable $to): ?int
    {
        $row = DB::table('trips')
            ->selectRaw('SUM(TIMESTAMPDIFF(MINUTE, started_at, completed_at)) as minutes')
            ->selectRaw('COUNT(*) as measured')
            ->where('driver_id', $driver->getKey())
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->whereNotNull('started_at')
            ->whereNotNull('completed_at')
            // `->utc()` for the reason spelled out in `entries()`: a bound
            // Carbon is formatted, not converted.
            ->where('completed_at', '>=', $from->utc())
            ->where('completed_at', '<', $to->utc())
            ->first();

        if ((int) ($row->measured ?? 0) === 0) {
            return null;
        }

        return (int) ($row->minutes ?? 0);
    }

    /**
     * The currency the entries were written in.
     *
     * Read off the rows rather than assumed, because AGENTS.md's money rules
     * pair every amount with its ISO 4217 code and a screen that hardcoded
     * `UGX` would be the first thing to break in a second market. Falls back
     * to the configured regional currency when there is nothing to read —
     * an empty period still has to say what its zero is denominated in.
     *
     * @param  list<array{trip_id: int|null, kind: string, amount_minor: int, currency: string, local_at: CarbonImmutable}>  $entries
     */
    private function currency(array $entries): string
    {
        if (isset($entries[0]) && $entries[0]['currency'] !== '') {
            return $entries[0]['currency'];
        }

        $configured = $this->settings->get('regional', 'currency');

        return is_string($configured) && $configured !== '' ? $configured : 'UGX';
    }

    /**
     * The timezone a driver's day is measured in.
     *
     * `settings.regional.timezone`, default `Africa/Kampala` and settable by
     * an administrator — which is what makes this screen work in the next
     * market rather than only in this one.
     *
     * **Not `config('app.timezone')`, which is UTC.** That is the bug this
     * whole class was written around: `Carbon::now()->startOfDay()` in UTC
     * rolls a Kampala driver's day at 03:00 local, so two hours of an evening
     * shift are filed under the previous day. Invisible on a home-screen
     * tile; unmissable on a screen whose subject is which day.
     */
    public function timezone(): string
    {
        $configured = $this->settings->get('regional', 'timezone');

        return is_string($configured) && $configured !== '' ? $configured : 'Africa/Kampala';
    }
}
