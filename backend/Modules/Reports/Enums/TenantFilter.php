<?php

namespace Modules\Reports\Enums;

/**
 * Whether a report lets a platform user name the client it is about
 * (ADR-0007).
 *
 * ADR-0007's central finding is that "open the reports to platform staff"
 * is three different decisions wearing one name, and this enum is those
 * three decisions written down once. It is not a validation detail: which
 * case a report carries decides whether its figures can span clients, and
 * that is the difference between a wider report and a wrong number.
 *
 * Never consulted for a client's own user. A client has exactly one tenant
 * and it is not a parameter they get to choose, so `tenant_id` is refused
 * for them on every report regardless of the case here.
 */
enum TenantFilter
{
    /**
     * The report always spans every client for platform staff, and takes no
     * `tenant_id`.
     *
     * The driver and vehicle reports. They aggregate the platform fleet,
     * which since ADR-0005 is genuinely Shanitah's — per-client utilisation
     * of a pooled vehicle is the less meaningful figure, and forcing a
     * client selection would answer a worse question than the one being
     * asked.
     */
    case NOT_ACCEPTED;

    /**
     * `tenant_id` may be given; omitting it spans every client.
     *
     * The trip report. It is row-shaped and behaves like the trips list
     * ADR-0006 already opened, so a cross-client view of it is a longer
     * list rather than a different number — with the one caveat recorded on
     * `records_incomplete`, which becomes a platform average when
     * unfiltered and is labelled accordingly.
     */
    case OPTIONAL;

    /**
     * `tenant_id` is required from platform staff; omitting it is a 422.
     *
     * The financial report, and the sharp edge of ADR-0007. Summing one
     * client's revenue with another's into a single "Total invoiced" is a
     * different and misleading number, and this report exports to PDF — a
     * figure that is only correct while its label is attached will
     * eventually appear without it. "All clients' revenue this month" is a
     * real question and a platform P&L, which deserves its own endpoint
     * rather than this one behaving differently depending on who asked.
     */
    case REQUIRED;
}
