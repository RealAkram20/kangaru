<?php

namespace Modules\Trips\Support;

use Modules\Bookings\Models\OrderRequest;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * Each party gets the other's real number, for as long as the trip is live
 * (ADR-0024 §7).
 *
 * ## The three rules, and why they are here rather than in a resource
 *
 * They are enforced in one class because they are one policy, and a policy
 * spread across two resources is a policy that gets applied to one and a half
 * of them. Both the driver's `TripResource` and the customer's ride payload
 * ask this object, so neither can drift.
 *
 * 1. **Only a walk-in trip.** A corporate booking's passenger is the client's
 *    business; their contact details live in the client's own systems, and
 *    this ADR is not the place to start publishing them.
 *
 * 2. **Only while the trip is live** — from `accepted` to `trip_completed`.
 *    Not before the accept, because an offer carries a pickup and a distance
 *    and a number handed to a driver who then declines is a number given
 *    away for nothing. Not after, because a completed trip is not a
 *    directory.
 *
 * 3. **Only if there is a number to give.** An order taken at the desk over
 *    a bad line may have no drop-off and a mistyped phone; a driver profile
 *    may predate the field being required. Null is returned rather than an
 *    empty string, so a client renders no call button instead of a dead one.
 */
class DirectContactChannel implements ContactChannel
{
    /**
     * Statuses during which the two parties have a reason to speak.
     *
     * Deliberately **not** `TripStatus::occupiesVehicle()`, which is the
     * closest existing predicate and would be wrong here in both directions:
     * it includes `assigned` — before the driver has accepted anything — and
     * it excludes `trip_completed`, which is exactly when a passenger rings
     * back about a bag on the seat.
     */
    private const LIVE = [
        TripStatus::ACCEPTED,
        TripStatus::DRIVER_EN_ROUTE,
        TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD,
        TripStatus::TRIP_STARTED,
        TripStatus::WAITING,
        TripStatus::TRIP_RESUMED,
        TripStatus::TRIP_COMPLETED,
    ];

    public function forPassenger(Trip $trip): ?ContactDetails
    {
        if (! $this->isOpen($trip)) {
            return null;
        }

        // The order request first, then the account — and each is taken as a
        // *whole* identity rather than field by field.
        //
        // The order matters: the number on it is the one the person typed
        // for this ride ("call me on my work phone, I'm at reception"),
        // while the account holds whatever they registered with, possibly
        // years ago. The order is the more recent statement of intent.
        //
        // Falling back per field was the first version and was wrong in a
        // way that would have been hard to see: an order with a name but a
        // blank phone would have paired that name with the account's number,
        // and the driver's screen would have shown one person's name above
        // another number. Either source answers completely or it does not
        // answer.
        $order = $this->orderFor($trip);

        if ($order !== null && $this->dialable($order->contact_phone)) {
            return new ContactDetails($order->contact_name, $order->contact_phone, $order->contact_name);
        }

        $customer = $trip->customer;

        if ($customer === null || ! $this->dialable($customer->phone)) {
            return null;
        }

        return new ContactDetails($customer->name, $customer->phone, $customer->name);
    }

    public function forDriver(Trip $trip): ?ContactDetails
    {
        if (! $this->isOpen($trip)) {
            return null;
        }

        $driver = $trip->driver;

        if ($driver === null || ! $this->dialable($driver->phone)) {
            return null;
        }

        return new ContactDetails($driver->name, $driver->phone, $driver->name);
    }

    /**
     * Whether there is actually something to dial.
     *
     * Only checks that the field is not blank, deliberately. Validating the
     * *shape* of a Ugandan mobile number here would refuse the +254 number
     * of a Kenyan passenger who ordered a ride in Kampala, and a call button
     * that is missing is a worse failure than one that dials a number the
     * network rejects — the second tells the driver something, the first
     * tells them the platform has no idea who they are collecting.
     */
    private function dialable(?string $phone): bool
    {
        return $phone !== null && trim($phone) !== '';
    }

    /**
     * Whether this trip is one where the parties may reach each other at all.
     */
    private function isOpen(Trip $trip): bool
    {
        return $trip->isWalkIn() && in_array($trip->status, self::LIVE, true);
    }

    /**
     * The order this trip came from.
     *
     * Looked up by `trip_id` rather than followed from a relation on the
     * trip, because the arrow points the other way: `order_requests.trip_id`
     * is what ADR-0024 §4 added, and a trip has no column naming its order.
     * A trip raised at the desk without one simply finds nothing, and the
     * customer's own record answers instead.
     */
    private function orderFor(Trip $trip): ?OrderRequest
    {
        return OrderRequest::query()->where('trip_id', $trip->id)->first();
    }
}