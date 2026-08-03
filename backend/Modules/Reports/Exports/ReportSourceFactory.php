<?php

namespace Modules\Reports\Exports;

use Modules\Reports\Enums\ReportType;
use Modules\Reports\Repositories\FinancialActivityRepository;
use Modules\Reports\Repositories\FleetActivityRepository;
use Modules\Reports\Repositories\TripReportRepository;
use Modules\Reports\Support\ReportScope;

/**
 * Resolves a report type and a scope to the thing that can produce it.
 *
 * One place that knows the mapping, so a queued export, an on-screen report
 * and a row-count check before queueing all agree about what "drivers"
 * means.
 *
 * Since ADR-0007 every source is constructed here rather than injected.
 * Two of the three used to come from the container, because they needed no
 * per-request argument; all three now need the `ReportScope`, and a scope
 * is per-request by definition. Making it a constructor argument rather
 * than a parameter on `rows()`/`summary()`/`count()` keeps the
 * `ReportSource` interface — and therefore the three writers — untouched,
 * and makes it impossible to build a file whose rows and whose totals were
 * scoped differently.
 */
class ReportSourceFactory
{
    public function __construct(
        private readonly TripReportRepository $trips,
        private readonly TripReportRowMapper $tripRows,
        private readonly FleetActivityRepository $fleet,
        private readonly FinancialActivityRepository $financial,
    ) {}

    public function for(ReportType $type, ReportScope $scope): ReportSource
    {
        return match ($type) {
            ReportType::TRIPS => new TripReportSource($this->trips, $this->tripRows, $scope),
            ReportType::DRIVERS, ReportType::VEHICLES => new FleetActivitySource($this->fleet, $type, $scope),
            ReportType::FINANCIAL => new FinancialReportSource($this->financial, $scope),
        };
    }
}
