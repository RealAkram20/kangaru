<?php

namespace Modules\Reports\Enums;

/**
 * The reports this module can produce.
 *
 * PROJECT.md's Phase 1 list is "trip, driver, vehicle, financial". The
 * first three are here; the financial report reads invoices and credit
 * notes rather than trips and is a separate pass (Modules/Reports/README.md).
 *
 * Persisted on `report_exports.report`, so never repurpose a case — an
 * export row records which report produced the file sitting on disk.
 */
enum ReportType: string
{
    case TRIPS = 'trips';
    case DRIVERS = 'drivers';
    case VEHICLES = 'vehicles';

    public function label(): string
    {
        return match ($this) {
            self::TRIPS => 'Trip report',
            self::DRIVERS => 'Driver report',
            self::VEHICLES => 'Vehicle report',
        };
    }

    /**
     * Used in the exported filename, so it has to survive a filesystem and
     * a mail attachment.
     */
    public function slug(): string
    {
        return $this->value;
    }
}
