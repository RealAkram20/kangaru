<?php

namespace Modules\Reports\Repositories;

use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Collection;
use Modules\Trips\Models\Trip;

/**
 * The driver and vehicle reports: the same aggregate over `trips`, grouped
 * by whoever or whatever did the work.
 *
 * A repository because ADR-0002 requires one for "non-trivial queries
 * (joins, aggregates, geospatial, reporting)" — this is three of the four.
 *
 * Both reports are built on the Trip model rather than the query builder so
 * ADR-0001's TenantScope applies. A raw DB::table() here would total every
 * tenant's fleet into one client's report, which is the same leak as
 * TripReportRepository guards against and just as invisible: it would not
 * show up as a stray row, it would show up as a bigger number.
 */
class FleetActivityRepository
{
    /**
     * One row per driver who commenced a trip in the period.
     *
     * @param  array<string, mixed>  $filters
     * @return Collection<int, \stdClass>
     */
    public function byDriver(array $filters): Collection
    {
        return $this->aggregate($filters, 'drivers', 'trips.driver_id', [
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
    public function byVehicle(array $filters): Collection
    {
        return $this->aggregate($filters, 'vehicles', 'trips.vehicle_id', [
            'vehicles.registration_number as entity_name',
            'vehicles.category as entity_reference',
            'vehicles.status as entity_status',
        ])->get();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function countByDriver(array $filters): int
    {
        return $this->byDriver($filters)->count();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function countByVehicle(array $filters): int
    {
        return $this->byVehicle($filters)->count();
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
    private function aggregate(array $filters, string $table, string $foreignKey, array $entityColumns)
    {
        $singular = rtrim($table, 's');

        return Trip::query()
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
