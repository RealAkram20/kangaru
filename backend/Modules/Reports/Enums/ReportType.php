<?php

namespace Modules\Reports\Enums;

use App\Enums\Permission;
use App\Models\User;

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
     * Every permission a reader must hold to see this report — all of them,
     * not any.
     *
     * `reports.view` alone used to gate all four, on the assumption that
     * running a report is one ability. It is not: a report is a *view of
     * some data*, and the reader needs to be allowed that data too. The
     * assumption held while every report aggregated trips, and stopped
     * holding when the financial report started aggregating invoices —
     * `reports.view` and `invoices.view` diverge across four seeded roles,
     * so a Dispatcher refused `/invoices` could read and export a client's
     * invoiced, credited and outstanding totals.
     *
     * Deliberately additive: `reports.view` says you may use the reports
     * area at all, and the second permission says which data you may have
     * in one. A custom role holding `invoices.view` but not `reports.view`
     * gets the Invoices page and no financial report, which is the right
     * reading of both grants.
     *
     * @return array<int, Permission>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::TRIPS, self::DRIVERS, self::VEHICLES => [Permission::REPORTS_VIEW],
            self::FINANCIAL => [Permission::REPORTS_VIEW, Permission::INVOICES_VIEW],
        };
    }

    /** Whether this user may see this report at all. */
    public function isReadableBy(User $user): bool
    {
        foreach ($this->permissions() as $permission) {
            if (! $user->hasPermission($permission)) {
                return false;
            }
        }

        return true;
    }

    /**
     * What one row counts, for anywhere a row total is shown to a user.
     *
     * "12 rows" is meaningless next to a download; "12 periods" and
     * "1,204 trips" are both immediately readable, and the export panel
     * previously hardcoded "trips" for every report — which was wrong for
     * the driver and vehicle reports and would have been misleading here.
     *
     * Pass the count to get agreement. Omitting it gives the plural, which
     * is what a bare column label wants; the notification body reads
     * "covering 1 period" rather than "1 periods", which is the sort of
     * thing nobody notices until it is on a page in front of a client.
     */
    public function rowNoun(?int $count = null): string
    {
        $plural = match ($this) {
            self::TRIPS => 'trips',
            self::DRIVERS => 'drivers',
            self::VEHICLES => 'vehicles',
            self::FINANCIAL => 'periods',
        };

        // Every noun here is a regular plural, so one rule covers them —
        // substr rather than rtrim, which would eat both esses of a word
        // like "buses" the day one is added.
        return $count === 1 ? substr($plural, 0, -1) : $plural;
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
