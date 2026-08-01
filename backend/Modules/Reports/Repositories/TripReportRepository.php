<?php

namespace Modules\Reports\Repositories;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Modules\Trips\Models\Trip;

/**
 * The trip report query. A repository because ADR-0002 requires one for
 * "non-trivial queries (joins, aggregates, geospatial, reporting)" — this
 * is all three of joins, aggregates and reporting, and both the paginated
 * view and the CSV export run it.
 *
 * Built on the Trip model rather than the query builder so ADR-0001's
 * TenantScope applies automatically. A raw DB::table() here would silently
 * report every tenant's trips, which for a bank client is the worst bug
 * this platform can have.
 */
class TripReportRepository
{
    /**
     * A trip with no `started_at` never commenced, so it has no "date and
     * time of trip commencement" — the first of the Bank's six required
     * data points. Such trips (cancelled before start, rejected, no-show)
     * are excluded from the report rather than listed with an empty first
     * column.
     *
     * @param  array<string, mixed>  $filters
     * @return Builder<Trip>
     */
    public function query(array $filters): Builder
    {
        return Trip::query()
            ->with(['vehicle:id,registration_number,make,model', 'driver:id,name', 'booking:id'])
            ->whereNotNull('started_at')
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('started_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('started_at', '<=', $to))
            ->when($filters['vehicle_id'] ?? null, fn ($q, $id) => $q->where('vehicle_id', $id))
            ->when($filters['driver_id'] ?? null, fn ($q, $id) => $q->where('driver_id', $id))
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderBy('started_at')
            ->orderBy('id');
    }

    /**
     * Headline figures for the same filtered set.
     *
     * `records_incomplete` is the one that matters to the anchor client:
     * PROJECT.md's success metric is "all six Bank-required data points
     * present on 100% of completed trips", so the report states how many
     * fall short rather than leaving it to be discovered in an audit.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters): array
    {
        $aggregate = $this->query($filters)
            ->reorder()
            ->selectRaw('COUNT(*) as trips')
            ->selectRaw('COALESCE(SUM(distance_km), 0) as distance_km')
            ->selectRaw('COALESCE(SUM(TIMESTAMPDIFF(MINUTE, started_at, completed_at)), 0) as duration_minutes')
            ->selectRaw('SUM(completed_at IS NOT NULL) as completed')
            ->selectRaw(
                'SUM(completed_at IS NOT NULL AND (odometer_start IS NULL OR odometer_end IS NULL '.
                'OR distance_km IS NULL)) as incomplete'
            )
            ->toBase()
            ->first();

        $completed = (int) ($aggregate->completed ?? 0);
        $incomplete = (int) ($aggregate->incomplete ?? 0);

        return [
            'trips' => (int) ($aggregate->trips ?? 0),
            'trips_completed' => $completed,
            'distance_km' => round((float) ($aggregate->distance_km ?? 0), 2),
            'duration_minutes' => (int) ($aggregate->duration_minutes ?? 0),
            'records_incomplete' => $incomplete,
            // Null rather than 100% when nothing completed — a compliance
            // figure invented from an empty set would read as a pass.
            'completeness_percent' => $completed === 0
                ? null
                : round((($completed - $incomplete) / $completed) * 100, 1),
        ];
    }

    /**
     * Streams the filtered set in chunks for export, so a large report
     * never loads every row into memory at once.
     *
     * @param  array<string, mixed>  $filters
     * @return \Generator<int, Collection<int, Trip>>
     */
    public function chunked(array $filters, int $size = 500): \Generator
    {
        $page = 1;

        do {
            /** @var Collection<int, Trip> $rows */
            $rows = $this->query($filters)->forPage($page, $size)->get();

            if ($rows->isNotEmpty()) {
                yield $rows;
            }

            $page++;
        } while ($rows->count() === $size);
    }
}
