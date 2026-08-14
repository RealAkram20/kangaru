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
 * What is deliberately absent is as important as what is here. There is no
 * rating, because the platform has never asked anybody for one. There is no
 * wallet balance, because payments are deferred by ADR-0005 and ADR-0012 to
 * a decision nobody has made. A screen showing an invented figure for either
 * would be lying to a driver about money or about their standing.
 */
class DriverStatsService
{
    public function __construct(private readonly DriverLedgerService $ledger) {}

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
        $startOfToday = Carbon::now()->startOfDay();

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

        return [
            'score' => round($recent->avg(), 1),
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
