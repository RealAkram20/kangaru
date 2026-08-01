<?php

namespace Modules\Reports\Enums;

/**
 * The reports this module can produce.
 *
 * PROJECT.md's Phase 1 list is "trip, driver, vehicle, financial", and all
 * four are now here. The first three are aggregates over trips; the
 * financial one reads invoices and credit notes out of Modules/Billing and
 * is the only one whose rows are periods rather than things.
 *
 * Persisted on `report_exports.report`, so never repurpose a case — an
 * export row records which report produced the file sitting on disk.
 */
enum ReportType: string
{
    case TRIPS = 'trips';
    case DRIVERS = 'drivers';
    case VEHICLES = 'vehicles';
    case FINANCIAL = 'financial';

    public function label(): string
    {
        return match ($this) {
            self::TRIPS => 'Trip report',
            self::DRIVERS => 'Driver report',
            self::VEHICLES => 'Vehicle report',
            self::FINANCIAL => 'Financial report',
        };
    }

    /**
     * What one row counts, for anywhere a row total is shown to a user.
     *
     * "12 rows" is meaningless next to a download; "12 periods" and
     * "1,204 trips" are both immediately readable, and the export panel
     * previously hardcoded "trips" for every report — which was wrong for
     * the driver and vehicle reports and would have been misleading here.
     */
    public function rowNoun(): string
    {
        return match ($this) {
            self::TRIPS => 'trips',
            self::DRIVERS => 'drivers',
            self::VEHICLES => 'vehicles',
            self::FINANCIAL => 'periods',
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
