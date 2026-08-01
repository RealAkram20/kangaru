<?php

namespace Modules\Bookings\Enums;

/**
 * The booking lifecycle from PROJECT.md's Trip Lifecycle diagram, up to the
 * point Dispatch hands over to Modules\Trips:
 *
 *     Booking Created -> Approved (optional) -> Assigned
 *
 * Approval is explicitly optional there, so `Pending -> Assigned` is a legal
 * edge: a dispatcher may assign straight off the queue without an approval
 * step. Once Assigned, the Trip's own state machine owns the rest of the
 * journey — this enum stops where TripStatus begins, and the two must never
 * be merged into one graph.
 */
enum BookingStatus: string
{
    case PENDING = 'pending';
    case APPROVED = 'approved';
    case REJECTED = 'rejected';
    case ASSIGNED = 'assigned';
    case CANCELLED = 'cancelled';

    /**
     * @return array<int, self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::PENDING => [self::APPROVED, self::REJECTED, self::ASSIGNED, self::CANCELLED],
            self::APPROVED => [self::ASSIGNED, self::CANCELLED],
            // Terminal. A rejected or cancelled booking is re-raised as a
            // new booking rather than revived, so the original request and
            // its decision reason stay an untouched audit record.
            self::REJECTED, self::ASSIGNED, self::CANCELLED => [],
        };
    }

    public function canTransitionTo(self $to): bool
    {
        return in_array($to, $this->allowedTransitions(), true);
    }

    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }

    /**
     * Whether this booking is still waiting on a dispatcher — the filter
     * behind the dispatch queue.
     */
    public function isDispatchable(): bool
    {
        return in_array($this, [self::PENDING, self::APPROVED], true);
    }
}
