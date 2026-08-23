<?php

namespace Modules\Bookings\Enums;

/**
 * The three services a visitor can ask for, straight from the product triad
 * in `material/` (ADR-0012): book a ride, send something, rent a vehicle.
 */
enum OrderRequestServiceType: string
{
    case RIDE = 'ride';
    case DELIVERY = 'delivery';
    case SELF_DRIVE = 'self_drive';

    /**
     * Whether a driver should be sent to this, unattended (ADR-0024 §3).
     *
     * A ride and a delivery are both journeys somebody is waiting on, and
     * automatic dispatch is exactly right for them. **A self-drive rental is
     * not a journey at all** — the customer collects a vehicle and drives it
     * themselves, for days, after their documents have been checked. There is
     * nobody to collect and no destination to reach.
     *
     * Asked as a question on the enum rather than as an `if` in the two places
     * that dispatch, because there are two: `OrderRequestService::receive()`
     * offers on arrival and `DispatchOfferService::retryUnoffered()` offers
     * again for anything the first pass could not place. A guard in only the
     * first is a guard the retry sweep walks straight past — which is the
     * shape of most of the bugs in this file's history.
     *
     * ## This was observed, not anticipated
     *
     * A five-day pickup rental placed from the web app — dates, KYC documents
     * and all — was offered to the nearest on-duty driver, who accepted it in
     * under a second. `DispatchOfferService::accept()` had no origin or
     * destination to use, so it fell back to its defaults and wrote a trip
     * reading **"Pickup → As directed"**. Nothing failed, nothing was logged,
     * and a driver was dispatched to a car somebody else was going to drive.
     *
     * The future-booking guard in `offerToDrivers()` did not catch it either,
     * and cannot: the self-drive form writes its hire period into
     * `details.start_date` / `details.end_date` and leaves `scheduled_for`
     * null, so a rental beginning next week reads as an immediate job.
     */
    public function dispatchesToDriver(): bool
    {
        return match ($this) {
            self::RIDE, self::DELIVERY => true,
            self::SELF_DRIVE => false,
        };
    }

    /**
     * The same rule, for a `whereIn`.
     *
     * Derived from `dispatchesToDriver()` rather than written out again, so a
     * fourth service added to this enum cannot be dispatchable in a query and
     * refused in the service — or the reverse, which is worse: silently
     * excluded from every sweep with nothing to point at.
     *
     * @return list<self>
     */
    public static function dispatchableToDriver(): array
    {
        return array_values(array_filter(self::cases(), fn (self $type) => $type->dispatchesToDriver()));
    }
}
