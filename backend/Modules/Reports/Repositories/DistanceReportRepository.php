<?php

namespace Modules\Reports\Repositories;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Modules\Reports\Support\ReportScope;

/**
 * The shadow report over measured distance (ADR-0045; Phase 1 step 5 of
 * `docs/measured-distance-plan.md`).
 *
 * One row per completed trip — its **latest** resolution — and, over the
 * whole filtered set, the distribution the flip is judged on: how many trips
 * came back A, B or C; how the trace's figure compares with the odometer and
 * with the road; how much of each trip the handset actually covered; and how
 * many completed trips have no resolution at all, which is the "is the queue
 * running" column ADR-0035 wished it had.
 *
 * Query builder rather than Eloquent, because every row is a join of the
 * evidence table onto the trip, its driver and its vehicle, and this is read
 * in pages by a report screen and summed once by an aggregate — the shape
 * ADR-0002 names as earning a repository. Tenant scoping is `ReportScope::
 * apply()` on `trips`, the same predicate every other report here uses; a
 * walk-in trip has no tenant and so appears in the all-clients scope and in
 * no client's.
 */
class DistanceReportRepository
{
    /**
     * @param  array<string, mixed>  $filters  from, to (against `trips.completed_at`), grade, provider
     */
    public function query(array $filters, ReportScope $scope): Builder
    {
        // The latest resolution of each trip. A trip resolved twice — late
        // pings, or a console force — has two rows in the evidence table,
        // and only the newer one is what the trip currently says.
        $latest = DB::table('trip_distance_evidence')
            ->selectRaw('MAX(id) AS id')
            ->groupBy('trip_id');

        $query = DB::table('trip_distance_evidence AS e')
            ->joinSub($latest, 'latest', 'latest.id', '=', 'e.id')
            ->join('trips', 'trips.id', '=', 'e.trip_id')
            ->leftJoin('drivers', 'drivers.id', '=', 'trips.driver_id')
            ->leftJoin('vehicles', 'vehicles.id', '=', 'trips.vehicle_id')
            ->whereNull('trips.deleted_at')
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('trips.completed_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('trips.completed_at', '<=', $to))
            ->when($filters['grade'] ?? null, fn ($q, $grade) => $q->where('e.grade', $grade))
            ->when($filters['provider'] ?? null, fn ($q, $provider) => $q->where('e.provider', $provider));

        if (! $scope->spansAllClients) {
            $query->where('trips.tenant_id', $scope->tenantId);
        }

        return $query;
    }

    /**
     * The rows, newest resolution first. Ordered on the evidence id alone —
     * unique and monotonic, so the cursor is one column and a resolution
     * that lands while somebody is paging appears at the top of the next
     * refresh rather than shifting the page they are on.
     *
     * @param  array<string, mixed>  $filters
     */
    public function rows(array $filters, ReportScope $scope): Builder
    {
        return $this->query($filters, $scope)
            ->select([
                'e.id AS evidence_id',
                'e.trip_id',
                'trips.tenant_id',
                'trips.origin',
                'trips.destination',
                'trips.completed_at',
                'trips.distance_variance_flagged',
                'drivers.name AS driver_name',
                'vehicles.registration_number AS vehicle_registration',
                'e.resolved_at',
                'e.policy',
                'e.grade',
                'e.billed_km',
                'e.reason',
                'e.odometer_km',
                'e.gps_km',
                'e.matched_km',
                'e.inferred_km',
                'e.route_km',
                'e.reference_source',
                'e.coverage_percent',
                'e.inferred_share_percent',
                'e.pings_total',
                'e.pings_kept',
                'e.provider',
            ])
            ->orderByDesc('e.id');
    }

    /**
     * The whole-set distribution. Every bucket is a `SUM(CASE …)` over the
     * same filtered join the rows come from, so the summary and the rows can
     * never disagree about which trips they cover.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters, ReportScope $scope): array
    {
        $odometerDeviation = 'ABS(e.gps_km - e.odometer_km) / e.odometer_km * 100';
        $routeDeviation = 'ABS(e.gps_km - e.route_km) / e.route_km * 100';

        /** @var array<string, mixed> $row */
        $row = (array) $this->query($filters, $scope)
            ->selectRaw('COUNT(*) AS resolved')
            ->selectRaw("SUM(e.grade = 'A') AS grade_a")
            ->selectRaw("SUM(e.grade = 'B') AS grade_b")
            ->selectRaw("SUM(e.grade = 'C') AS grade_c")
            ->selectRaw("SUM(e.grade = 'U') AS grade_u")
            ->selectRaw("SUM(e.provider = 'osrm') AS provider_osrm")
            ->selectRaw("SUM(e.provider = 'haversine') AS provider_haversine")
            ->selectRaw('SUM(e.gps_km IS NULL) AS no_trace')
            ->selectRaw('SUM(e.route_km IS NULL) AS no_reference')
            ->selectRaw('SUM(trips.distance_variance_flagged) AS variance_flagged')
            ->selectRaw('SUM(e.dropped IS NOT NULL AND JSON_EXTRACT(e.dropped, \'$.mock\') > 0) AS with_mock_pings')
            ->selectRaw('AVG(e.coverage_percent) AS mean_coverage_percent')
            ->selectRaw('AVG(e.inferred_share_percent) AS mean_inferred_share_percent')
            // Coverage buckets.
            ->selectRaw('SUM(e.coverage_percent IS NULL) AS coverage_unknown')
            ->selectRaw('SUM(e.coverage_percent < 50) AS coverage_under_50')
            ->selectRaw('SUM(e.coverage_percent >= 50 AND e.coverage_percent < 80) AS coverage_50_to_80')
            ->selectRaw('SUM(e.coverage_percent >= 80 AND e.coverage_percent < 95) AS coverage_80_to_95')
            ->selectRaw('SUM(e.coverage_percent >= 95) AS coverage_95_up')
            // Trace against odometer, as a share of the odometer.
            ->selectRaw('SUM(e.gps_km IS NULL OR e.odometer_km IS NULL OR e.odometer_km = 0) AS odometer_unknown')
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.odometer_km > 0 AND {$odometerDeviation} <= 5) AS odometer_within_5")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.odometer_km > 0 AND {$odometerDeviation} > 5 AND {$odometerDeviation} <= 15) AS odometer_5_to_15")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.odometer_km > 0 AND {$odometerDeviation} > 15 AND {$odometerDeviation} <= 30) AS odometer_15_to_30")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.odometer_km > 0 AND {$odometerDeviation} > 30) AS odometer_over_30")
            // Trace against the road, as a share of the reference.
            ->selectRaw('SUM(e.gps_km IS NULL OR e.route_km IS NULL OR e.route_km = 0) AS route_unknown')
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.route_km > 0 AND {$routeDeviation} <= 5) AS route_within_5")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.route_km > 0 AND {$routeDeviation} > 5 AND {$routeDeviation} <= 15) AS route_5_to_15")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.route_km > 0 AND {$routeDeviation} > 15 AND {$routeDeviation} <= 30) AS route_15_to_30")
            ->selectRaw("SUM(e.gps_km IS NOT NULL AND e.route_km > 0 AND {$routeDeviation} > 30) AS route_over_30")
            ->first();

        $resolved = (int) ($row['resolved'] ?? 0);

        return [
            'resolved' => $resolved,
            // Completed trips in the same period and scope that the resolver
            // has not answered for. Non-zero and growing means the queue is
            // not running — the silent failure ADR-0035 recorded.
            'unresolved' => $this->unresolved($filters, $scope),
            'grades' => [
                'A' => (int) ($row['grade_a'] ?? 0),
                'B' => (int) ($row['grade_b'] ?? 0),
                'C' => (int) ($row['grade_c'] ?? 0),
                'U' => (int) ($row['grade_u'] ?? 0),
            ],
            'providers' => [
                'osrm' => (int) ($row['provider_osrm'] ?? 0),
                'haversine' => (int) ($row['provider_haversine'] ?? 0),
            ],
            'no_trace' => (int) ($row['no_trace'] ?? 0),
            'no_reference' => (int) ($row['no_reference'] ?? 0),
            'variance_flagged' => (int) ($row['variance_flagged'] ?? 0),
            'with_mock_pings' => (int) ($row['with_mock_pings'] ?? 0),
            // Null rather than zero over an empty set — a mean nobody
            // measured must not read as "no coverage".
            'mean_coverage_percent' => $this->mean($row['mean_coverage_percent'] ?? null),
            'mean_inferred_share_percent' => $this->mean($row['mean_inferred_share_percent'] ?? null),
            'coverage' => [
                'under_50' => (int) ($row['coverage_under_50'] ?? 0),
                '50_to_80' => (int) ($row['coverage_50_to_80'] ?? 0),
                '80_to_95' => (int) ($row['coverage_80_to_95'] ?? 0),
                '95_up' => (int) ($row['coverage_95_up'] ?? 0),
                'unknown' => (int) ($row['coverage_unknown'] ?? 0),
            ],
            'trace_vs_odometer' => [
                'within_5' => (int) ($row['odometer_within_5'] ?? 0),
                '5_to_15' => (int) ($row['odometer_5_to_15'] ?? 0),
                '15_to_30' => (int) ($row['odometer_15_to_30'] ?? 0),
                'over_30' => (int) ($row['odometer_over_30'] ?? 0),
                'unknown' => (int) ($row['odometer_unknown'] ?? 0),
            ],
            'trace_vs_route' => [
                'within_5' => (int) ($row['route_within_5'] ?? 0),
                '5_to_15' => (int) ($row['route_5_to_15'] ?? 0),
                '15_to_30' => (int) ($row['route_15_to_30'] ?? 0),
                'over_30' => (int) ($row['route_over_30'] ?? 0),
                'unknown' => (int) ($row['route_unknown'] ?? 0),
            ],
        ];
    }

    private function mean(mixed $value): ?float
    {
        return $value === null || ! is_numeric($value) ? null : round((float) $value, 1);
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    private function unresolved(array $filters, ReportScope $scope): int
    {
        $query = DB::table('trips')
            ->whereNull('deleted_at')
            ->where('status', 'trip_completed')
            ->whereNull('distance_resolved_at')
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('completed_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('completed_at', '<=', $to));

        if (! $scope->spansAllClients) {
            $query->where('tenant_id', $scope->tenantId);
        }

        return $query->count();
    }
}
