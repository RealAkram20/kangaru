<?php

namespace Modules\Reports\Exports;

use Illuminate\Support\Collection;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Repositories\FleetActivityRepository;

/**
 * The driver and vehicle reports.
 *
 * One class for both, because they are the same aggregate grouped by a
 * different column — separating them would duplicate every figure below so
 * that two headers could differ. What differs is named in `LABELS` and
 * nothing else.
 */
class FleetActivitySource implements ReportSource
{
    public function __construct(
        private readonly FleetActivityRepository $repository,
        private readonly ReportType $type,
    ) {}

    /**
     * The two columns that identify the thing being reported on. Everything
     * after them is identical between the reports.
     *
     * A match rather than an array keyed by the enum's value: the trip and
     * financial reports are ReportTypes too, and this source cannot produce
     * either. The match makes that a stated refusal instead of an undefined
     * index that would surface as a blank column header — and, because it
     * is exhaustive, PHPStan fails the build when a new report type is
     * added without a decision being made here. That is how the financial
     * report was caught.
     *
     * @return array{0: string, 1: string}
     */
    private function identityColumns(): array
    {
        return match ($this->type) {
            ReportType::DRIVERS => ['Driver', 'Licence number'],
            ReportType::VEHICLES => ['Vehicle registration', 'Category'],
            ReportType::TRIPS => throw new \InvalidArgumentException(
                'The trip report is row-per-trip, not an aggregate — use TripReportSource.'
            ),
            ReportType::FINANCIAL => throw new \InvalidArgumentException(
                'The financial report aggregates invoices, not trips — use FinancialReportSource.'
            ),
        };
    }

    public function title(): string
    {
        return 'KangaruRide — '.$this->type->label();
    }

    /**
     * @return array<int, string>
     */
    public function headers(): array
    {
        [$name, $reference] = $this->identityColumns();

        return [
            $name,
            $reference,
            'Status',
            'Trips',
            'Trips completed',
            'Distance travelled (km)',
            'Time on the road (minutes)',
            'Time on the road (h:mm)',
            'Average distance per trip (km)',
            'Odometer variances flagged',
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return \Generator<int, array<int, string|int|float|null>>
     */
    public function rows(array $filters): \Generator
    {
        foreach ($this->fetch($filters) as $row) {
            $trips = (int) $row->trips;
            $distance = (float) $row->distance_km;
            $minutes = (int) $row->duration_minutes;

            yield [
                $row->entity_name,
                $row->entity_reference,
                $row->entity_status,
                $trips,
                (int) $row->trips_completed,
                round($distance, 2),
                $minutes,
                sprintf('%d:%02d', intdiv($minutes, 60), $minutes % 60),
                // Guarded, though the query cannot return a zero-trip row:
                // the aggregate only produces rows for trips that exist.
                $trips === 0 ? 0 : round($distance / $trips, 2),
                (int) $row->variance_flagged,
            ];
        }
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters): array
    {
        $rows = $this->fetch($filters);

        $trips = $rows->sum(fn ($row) => (int) $row->trips);
        $distance = $rows->sum(fn ($row) => (float) $row->distance_km);

        return [
            // "Drivers" or "Vehicles" — the count of things that did any
            // work in the period, which is not the size of the fleet.
            'entities_active' => $rows->count(),
            'trips' => $trips,
            'trips_completed' => $rows->sum(fn ($row) => (int) $row->trips_completed),
            'distance_km' => round($distance, 2),
            'duration_minutes' => $rows->sum(fn ($row) => (int) $row->duration_minutes),
            'variance_flagged' => $rows->sum(fn ($row) => (int) $row->variance_flagged),
            'average_distance_km' => $trips === 0 ? 0.0 : round($distance / $trips, 2),
        ];
    }

    /**
     * @param  array<string, mixed>  $summary
     * @return array<int, array{label: string, value: string}>
     */
    public function summaryCells(array $summary): array
    {
        return [
            [
                'label' => $this->type === ReportType::DRIVERS ? 'Drivers active' : 'Vehicles active',
                'value' => number_format((int) $summary['entities_active']),
            ],
            ['label' => 'Trips', 'value' => number_format((int) $summary['trips'])],
            ['label' => 'Completed', 'value' => number_format((int) $summary['trips_completed'])],
            ['label' => 'Distance', 'value' => number_format((float) $summary['distance_km'], 2).' km'],
            [
                'label' => 'Time on the road',
                'value' => number_format((int) $summary['duration_minutes']).' min',
            ],
            [
                'label' => 'Variances flagged',
                'value' => number_format((int) $summary['variance_flagged']),
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function period(array $filters): string
    {
        return ReportPeriod::describe($filters, 'Trips commencing');
    }

    public function emptyMessage(): string
    {
        return $this->type === ReportType::DRIVERS
            ? 'No driver commenced a trip in this period.'
            : 'No vehicle commenced a trip in this period.';
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function count(array $filters): int
    {
        return $this->fetch($filters)->count();
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return Collection<int, \stdClass>
     */
    private function fetch(array $filters): Collection
    {
        return $this->type === ReportType::DRIVERS
            ? $this->repository->byDriver($filters)
            : $this->repository->byVehicle($filters);
    }
}
