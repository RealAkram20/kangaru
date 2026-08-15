<?php

namespace Modules\Drivers\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;

/**
 * The numbers on a driver's home screen.
 *
 * Every figure here is counted from rows that already exist — offers the
 * dispatcher made, trips this driver finished, fares the walk-in tariff
 * priced (ADR-0026). Nothing is estimated and nothing is stored: these are
 * derived on read, because a cached counter that drifts from its source is
 * worse than a query, and the query is small and indexed.
 *
 * **The paragraph that used to sit here said there was no rating and no
 * wallet balance, and both statements outlived the code by a day.** ADR-0030
 * added ratings and ADR-0029 added the ledger, and this class serves both — a
 * docblock asserting their absence is worse than none, because it is the one
 * thing a reader trusts without checking. What remains true is the principle
 * underneath: a figure the platform cannot produce is served as null and
 * rendered as an em dash, never invented. `acceptance_rate`, `completion_rate`
 * and `rating` are all nullable for that reason.
 *
 * "Today" here means the driver's local day, from
 * `settings.regional.timezone` — see `forDriver()`.
 */
class DriverStatsService
{
    public function __construct(
        private readonly DriverLedgerService $ledger,
        private readonly DriverEarningsService $earnings,
    ) {}

    /**
     * The window the rates are measured over.
     *
     * Thirty days, not all time: a driver who declined heavily in their first
     * week should be able to work out of it, and an all-time rate becomes
     * unmovable — at which point it stops being feedback and becomes a brand.
     */
    public const WINDOW_DAYS = 30;

    /**
     * Ratings needed before a score is published (ADR-0030 §3).
     *
     * One three-star rating is not a 3.0; it is one person's afternoon.
     */
    public const RATINGS_BEFORE_PUBLISHING = 5;

    /** The score is the mean of this many most recent ratings (ADR-0030 §4). */
    public const RATING_SAMPLE = 50;

    /**
     * @return array{
     *     trips_today: int,
     *     earnings_today_minor: int,
     *     wallet_balance_minor: int,
     *     currency: string,
     *     acceptance_rate: float|null,
     *     completion_rate: float|null,
     *     rating: float|null,
     *     rating_count: int,
     *     window_days: int
     * }
     */
    public function forDriver(Driver $driver): array
    {
        $since = Carbon::now()->subDays(self::WINDOW_DAYS);

        // **The driver's local day, not UTC.** `config/app.php` sets the app
        // timezone to UTC, so the `Carbon::now()->startOfDay()` this used to
        // call rolled a Kampala driver's day over at 03:00 local — the last
        // two hours of an evening shift were filed under the previous day,
        // and the tile a driver opens the app for was quietly wrong twice a
        // night. Found while building the earnings screen, where the same
        // boundary is the screen's entire subject.
        //
        // `DriverEarningsService` owns the timezone lookup
        // (`settings.regional.timezone`) so the two surfaces cannot drift:
        // "Earnings today" here and "Today's earnings" there must be the same
        // number, and two independent readings of "today" is exactly how they
        // would stop being.
        //
        // `->utc()` on the end is not cosmetic. Laravel binds a Carbon to SQL
        // by *formatting* it in its own timezone rather than converting, so a
        // `+03:00` boundary would arrive as a UTC wall-clock string and put
        // the window three hours out — silently, with every figure still
        // looking plausible. Converting first makes the bound instant and its
        // rendering agree.
        $startOfToday = Carbon::now($this->earnings->timezone())->startOfDay()->utc();

        $today = $this->today($driver, $startOfToday);
        $rating = $this->rating($driver);

        return [
            'trips_today' => $today['trips'],
            // The driver's own share, from the ledger — not the gross fare
            // the passenger paid (ADR-0029 §5). Minor units as an integer,
            // never a float: money here is not a binary fraction.
            'earnings_today_minor' => $this->ledger->earnedSinceMinor($driver, $startOfToday),
            // Negative is legitimate and means the driver is holding the
            // platform's cash until they settle.
            'wallet_balance_minor' => $this->ledger->balanceMinor($driver),
            'currency' => $today['currency'],
            'acceptance_rate' => $this->acceptanceRate($driver, $since),
            'completion_rate' => $this->completionRate($driver, $since),
            'rating' => $rating['score'],
            'rating_count' => $rating['count'],
            'window_days' => self::WINDOW_DAYS,
        ];
    }

    /**
     * The mean of the most recent ratings, withheld until there are enough
     * of them to mean anything (ADR-0030 §3-4).
     *
     * `rating_count` is returned regardless, so the app can say what the
     * score rests on instead of presenting a bare number — and so a driver
     * with four ratings can see they are one away from a score rather than
     * wondering why the tile is blank.
     *
     * @return array{score: float|null, count: int}
     */
    private function rating(Driver $driver): array
    {
        $recent = DB::table('trip_ratings')
            ->select('stars')
            ->where('driver_id', $driver->getKey())
            ->orderByDesc('created_at')
            ->limit(self::RATING_SAMPLE)
            ->pluck('stars');

        if ($recent->count() < self::RATINGS_BEFORE_PUBLISHING) {
            return ['score' => null, 'count' => $recent->count()];
        }

        // `sum() / count()` rather than `avg()`, and not to satisfy a linter
        // for its own sake: `avg()` returns null on an empty collection, so
        // `round()` receives a nullable and Larastan level 8 refuses it. The
        // guard above already proves the collection is not empty — but the
        // proof is three lines away and static analysis cannot follow it.
        // Dividing is the same arithmetic with the null removed at the source
        // rather than cast away, which AGENTS.md's gate is right to insist on.
        return [
            'score' => round($recent->sum() / $recent->count(), 1),
            'count' => $recent->count(),
        ];
    }

    /**
     * Today's finished work, and what was collected for it.
     *
     * `fare_minor` is set only on walk-in trips — a corporate ride is billed
     * to the client through an invoice and carries no per-trip fare (ADR-0026
     * §3). So this sums cash actually taken, which is the number a boda rider
     * counts at the end of a day, and it is deliberately NOT called earnings:
     * without a commission model there is no such figure yet.
     */
    /**
     * @return array{trips: int, fares: int, currency: string}
     */
    private function today(Driver $driver, Carbon $startOfToday): array
    {
        $row = DB::table('trips')
            ->selectRaw('COUNT(*) as trips')
            ->selectRaw('COALESCE(SUM(fare_minor), 0) as fares')
            ->selectRaw('MAX(fare_currency) as currency')
            ->where('driver_id', $driver->getKey())
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->where('completed_at', '>=', $startOfToday)
            ->first();

        return [
            'trips' => (int) ($row->trips ?? 0),
            'fares' => (int) ($row->fares ?? 0),
            // Every trip today is priced in one currency in practice; MAX()
            // picks one rather than assuming, and UGX stands in when no fare
            // was recorded at all.
            'currency' => (string) ($row->currency ?? 'UGX'),
        ];
    }

    /**
     * Offers taken, over offers this driver was actually asked to answer.
     *
     * `superseded` is excluded on purpose: that status means dispatch pulled
     * the offer back — somebody else took the job, or the round moved on —
     * and counting it against the driver would penalise them for being slower
     * than a machine. `expired` *is* counted: an offer that rang out
     * unanswered is a job the passenger did not get.
     */
    private function acceptanceRate(Driver $driver, Carbon $since): ?float
    {
        $answerable = [
            DispatchOfferStatus::ACCEPTED->value,
            DispatchOfferStatus::DECLINED->value,
            DispatchOfferStatus::EXPIRED->value,
        ];

        $counts = DB::table('dispatch_offers')
            ->selectRaw('COUNT(*) as total')
            ->selectRaw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as accepted', [
                DispatchOfferStatus::ACCEPTED->value,
            ])
            ->where('driver_id', $driver->getKey())
            ->whereIn('status', $answerable)
            ->where('offered_at', '>=', $since)
            ->first();

        return $this->rate((int) ($counts->accepted ?? 0), (int) ($counts->total ?? 0));
    }

    /**
     * Trips finished, over trips that reached an end this driver influenced.
     *
     * `cancelled` and `no_show` are the other two endings. A cancellation is
     * not always the driver's doing — a passenger can call it off — and this
     * rate does not pretend to apportion blame; it is the completion rate of
     * work assigned to them, which is what the fleet office reads it as.
     */
    private function completionRate(Driver $driver, Carbon $since): ?float
    {
        $terminal = [
            TripStatus::TRIP_COMPLETED->value,
            TripStatus::CANCELLED->value,
            TripStatus::NO_SHOW->value,
        ];

        $counts = DB::table('trips')
            ->selectRaw('COUNT(*) as total')
            ->selectRaw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as completed', [
                TripStatus::TRIP_COMPLETED->value,
            ])
            ->where('driver_id', $driver->getKey())
            ->whereIn('status', $terminal)
            ->whereNull('deleted_at')
            ->where('updated_at', '>=', $since)
            ->first();

        return $this->rate((int) ($counts->completed ?? 0), (int) ($counts->total ?? 0));
    }

    /**
     * Null, not zero, when there is nothing to divide by.
     *
     * A driver on their first shift has no acceptance rate; showing them 0%
     * would read as a failing grade for having done nothing wrong, and the
     * app renders null as "—".
     */
    private function rate(int $part, int $total): ?float
    {
        return $total === 0 ? null : round(($part / $total) * 100, 1);
    }
}
