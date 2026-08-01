<?php

namespace Modules\Reports\Exports;

use Modules\Reports\Repositories\TripReportRepository;

/**
 * The trip report, behind the common ReportSource shape.
 *
 * A thin adapter on purpose: the repository and the row mapper were already
 * the right pieces, and rewriting them to satisfy a new interface would
 * have risked changing what the Bank's acceptance report says. This only
 * changes who asks.
 */
class TripReportSource implements ReportSource
{
    public function __construct(
        private readonly TripReportRepository $repository,
        private readonly TripReportRowMapper $mapper,
    ) {}

    public function title(): string
    {
        return 'KangaruRide — Trip report';
    }

    /**
     * @return array<int, string>
     */
    public function headers(): array
    {
        return $this->mapper->headers();
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return \Generator<int, array<int, string|int|float|null>>
     */
    public function rows(array $filters): \Generator
    {
        // Chunked, not fetched: a month at target scale is tens of
        // thousands of trips and the writers stream straight to disk.
        foreach ($this->repository->chunked($filters) as $chunk) {
            foreach ($chunk as $trip) {
                yield $this->mapper->row($trip);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters): array
    {
        return $this->repository->summary($filters);
    }

    /**
     * @param  array<string, mixed>  $summary
     * @return array<int, array{label: string, value: string}>
     */
    public function summaryCells(array $summary): array
    {
        return [
            ['label' => 'Trips', 'value' => number_format((int) $summary['trips'])],
            ['label' => 'Completed', 'value' => number_format((int) $summary['trips_completed'])],
            ['label' => 'Distance', 'value' => number_format((float) $summary['distance_km'], 2).' km'],
            ['label' => 'Time on the road', 'value' => number_format((int) $summary['duration_minutes']).' min'],
            [
                'label' => 'Records complete',
                // Never an invented 100% over an empty set — the figure is a
                // compliance claim and "n/a" is the honest one.
                'value' => $summary['completeness_percent'] === null
                    ? 'n/a'
                    : $summary['completeness_percent'].'%',
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
        return 'No trips commenced in this period.';
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function count(array $filters): int
    {
        return $this->repository->query($filters)->toBase()->getCountForPagination();
    }
}
