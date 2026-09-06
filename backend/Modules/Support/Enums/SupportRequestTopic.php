<?php

namespace Modules\Support\Enums;

/**
 * What a driver's report is about (ADR-0044 §1).
 *
 * **These are the Help Topics rows**, which is the whole point of this enum
 * existing rather than a free-text subject line. Before ADR-0044 the five were
 * a hardcoded array in the driver app pointing five ways at one phone number;
 * they are now the category of a real record, and the same five strings name
 * the row in the office queue.
 *
 * The labels are the owner's own words from the mockup and are not to be
 * rewritten here for tidiness — a driver scans for "my car", and the office
 * reads the same phrase back on the queue.
 *
 * **Never repurpose a case.** Stored rows carry the value, and a renamed case
 * silently re-files somebody's old report under a heading they never chose.
 */
enum SupportRequestTopic: string
{
    case REPORT = 'report';
    case PASSENGER = 'passenger';
    case VEHICLE = 'vehicle';
    case PAYMENT = 'payment';
    case LOST_ITEM = 'lost_item';

    public function label(): string
    {
        return match ($this) {
            self::REPORT => 'Report an issue',
            self::PASSENGER => 'Passenger issue',
            self::VEHICLE => 'Vehicle issue',
            self::PAYMENT => 'Payment issue',
            self::LOST_ITEM => 'Lost item',
        };
    }

    /**
     * Whether a report of this kind is normally about one journey.
     *
     * Read by the driver app to decide whether to offer the trip picker, and
     * **advisory in both directions**: a vehicle fault can happen on a trip and
     * a payment query might not be about one. Nothing refuses a report for
     * disagreeing with it — a validator that argued with a driver about which
     * of their problems counts as trip-related would be worse than a null
     * column.
     */
    public function usuallyAboutATrip(): bool
    {
        return match ($this) {
            self::PASSENGER, self::PAYMENT, self::LOST_ITEM => true,
            self::REPORT, self::VEHICLE => false,
        };
    }
}
