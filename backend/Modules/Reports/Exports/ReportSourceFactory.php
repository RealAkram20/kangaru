<?php

namespace Modules\Reports\Exports;

use Modules\Reports\Enums\ReportType;
use Modules\Reports\Repositories\FleetActivityRepository;

/**
 * Resolves a report type to the thing that can produce it.
 *
 * One place that knows the mapping, so a queued export, an on-screen report
 * and a row-count check before queueing all agree about what "drivers"
 * means. `FleetActivitySource` takes its type as a constructor argument, so
 * it cannot be resolved from the container alone — which is the whole
 * reason this exists rather than a container binding.
 */
class ReportSourceFactory
{
    public function __construct(
        private readonly TripReportSource $trips,
        private readonly FleetActivityRepository $fleet,
    ) {}

    public function for(ReportType $type): ReportSource
    {
        return match ($type) {
            ReportType::TRIPS => $this->trips,
            ReportType::DRIVERS, ReportType::VEHICLES => new FleetActivitySource($this->fleet, $type),
        };
    }
}
