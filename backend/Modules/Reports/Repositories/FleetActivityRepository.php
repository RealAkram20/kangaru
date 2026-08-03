<?php

namespace Modules\Reports\Repositories;

use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Collection;
use Modules\Reports\Support\ReportScope;
use Modules\Trips\Models\Trip;

/**
 * The driver and vehicle reports: the same aggregate over `trips`, grouped
 * by whoever or whatever did the work.
 *
 * A repository because ADR-0002 requires one for "non-trivial queries
 * (joins, aggregates, geospatial, reporting)" — this is three of the four.
 *
 * Both reports are built on the Trip model rather than the query builder,
 * so a `ReportScope` is the only thing that can widen them. A raw
 * DB::table() here would total every tenant's fleet into one client's
 * report, which is the same leak as TripReportRepository guards against and
 * just as invisible: it would not show up as a stray row, it would show up
 * as a bigger number.
 *
 * ## Scoping (ADR-0007)
 *
 * These two reports are the ones ADR-0007 lets span every client for
 * platform staff, with no filter offered. They aggregate the platform
 * fleet, which since ADR-0005 is Shanitah's — per-client utilisation of a
 * pooled vehicle is the less meaningful figure. That is a property of the
 * scope handed in, not something decided here: the repository applies
 * whatever scope it is given and has no opinion about who asked.
 *
 * `countBy*` take the scope for the same reason the `byX` methods do, and
 * ADR-0007 named them as the easy ones to miss. A paginated report whose
 * total was computed under a different scope than its rows is a bug that
 * looks like an off-by-one.
 */
class FleetActivityRepository
{
    /**
     * One row per driver who commenced a trip in the period.
     *
     * @param  array<string, mixed>  $filters
     * @return Collection<int, \stdClass>
     */
    public function byDriver(array $filters, ReportScope $scope): Collection
    {
        return $this->aggregate($filters, $scope, 'drivers', 'trips.driver_id', [
            'drivers.name as entity_name',
            'drivers.license_number as entity_reference',
            'drivers.status as entity_status',
        ])->get();
    }

    /**
     * One row per vehicle that commenced a trip in the period.
     *
     * @param  array<string, mixed>  $filters
     * @return Collection<int, \stdClass>
     */
    public function byVehicle(array $filters, ReportScope $scope): Collection
    {
        return $this->aggregate($filters, $scope, 'vehicles', 'trips.vehicle_id', [
            'vehicles.registration_number as entity_name',
            'vehicles.category as entity_reference',
            'vehicles.status as entity_status',
        ])->get();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function countByDriver(array $filters, ReportScope $scope): int
    {
        return $this->byDriver($filters, $scope)->count();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function countByVehicle(array $filters, ReportScope $scope): int
    {
        return $this->byVehicle($filters, $scope)->count();
    }

    /**
     * The shared aggregate.
     *
     * Only trips that actually commenced are counted — a trip with no
     * `started_at` never happened, so counting it against a driver would
     * make a cancelled booking look like work they did. Same line the trip
     * report draws.
     *
     * @param  array<string, mixed>  $filters
     * @param  array<int, string>  $entityColumns
     * @return QueryBuilder
     */
    private function aggregate(
        array $filters,
        ReportScope $scope,
        string $table,
        string $foreignKey,
        array $entityColumns,
    ) {
        $singular = rtrim($table, 's');

        // Qualified as `trips.tenant_id`: `drivers` and `vehicles` lost
        // their tenant column in ADR-0005, and an unqualified `tenant_id`
        // across this join would be ambiguous the day either gets one back.
        return $scope->apply(Trip::query(), 'trips')
            ->join($table, $foreignKey, '=', $table.'.id')
            ->whereNotNull('trips.started_at')
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('trips.started_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('trips.started_at', '<=', $to))
            ->groupBy($foreignKey, ...array_map(
                fn (string $column) => explode(' as ', $column)[0],
                $entityColumns,
            ))
            ->select([$foreignKey.' as entity_id', ...$entityColumns])
            ->selectRaw('COUNT(*) as trips')
            ->selectRaw('SUM(trips.completed_at IS NOT NULL) as trips_completed')
            ->selectRaw('COALESCE(SUM(trips.distance_km), 0) as distance_km')
            ->selectRaw(
                'COALESCE(SUM(TIMESTAMPDIFF(MINUTE, trips.started_at, trips.completed_at)), 0) as duration_minutes'
            )
            // The odometer/GPS disagreements PROJECT.md wants reviewed
            // within two business days, attributed to who drove them.
            ->selectRaw('SUM(trips.distance_variance_flagged) as variance_flagged')
            ->orderByDesc('distance_km')
            ->orderBy($singular === 'driver' ? 'drivers.name' : 'vehicles.registration_number')
            // toBase(): the rows are aggregates, not Trips. Hydrating them
            // into Trip models would produce objects whose `id` is a
            // driver's and whose columns are sums — an invitation to a bug.
            ->toBase();
    }
}
