<?php

namespace Modules\Trips\Enums;

/**
 * The trip lifecycle graph (AGENTS.md "Trip State Machine"). This is the
 * single source of truth for the transition map — TripStateMachine is the
 * only code path that consults allowedTransitions(); never duplicate this
 * list elsewhere.
 */
enum TripStatus: string
{
    case ASSIGNED = 'assigned';
    case REJECTED = 'rejected';
    case ACCEPTED = 'accepted';
    case DRIVER_EN_ROUTE = 'driver_en_route';
    case DRIVER_ARRIVED = 'driver_arrived';
    case NO_SHOW = 'no_show';
    case PASSENGER_ONBOARD = 'passenger_onboard';
    case TRIP_STARTED = 'trip_started';
    case WAITING = 'waiting';
    case TRIP_RESUMED = 'trip_resumed';
    case TRIP_COMPLETED = 'trip_completed';
    case INVOICE_GENERATED = 'invoice_generated';
    case DISPUTED = 'disputed';
    case CLOSED = 'closed';
    case CANCELLED = 'cancelled';

    /**
     * @return array<int, self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::ASSIGNED => [self::ACCEPTED, self::REJECTED, self::CANCELLED],
            // "Back to the dispatch pool" is modeled as re-assigning the
            // same Trip row (Modules/Dispatch doesn't exist yet) — a
            // dispatcher either reassigns or gives up and cancels.
            self::REJECTED => [self::ASSIGNED, self::CANCELLED],
            self::ACCEPTED => [self::DRIVER_EN_ROUTE, self::CANCELLED],
            self::DRIVER_EN_ROUTE => [self::DRIVER_ARRIVED, self::CANCELLED],
            self::DRIVER_ARRIVED => [self::PASSENGER_ONBOARD, self::NO_SHOW, self::CANCELLED],
            self::PASSENGER_ONBOARD => [self::TRIP_STARTED, self::CANCELLED],
            // Opening odometer captured on this transition.
            self::TRIP_STARTED => [self::WAITING, self::TRIP_COMPLETED],
            self::WAITING => [self::TRIP_RESUMED],
            self::TRIP_RESUMED => [self::WAITING, self::TRIP_COMPLETED],
            // Closing odometer captured on this transition.
            self::TRIP_COMPLETED => [self::INVOICE_GENERATED],
            self::INVOICE_GENERATED => [self::DISPUTED, self::CLOSED],
            // Resolution notes required at the request layer.
            self::DISPUTED => [self::CLOSED],
            // Terminal: No Show has its own non-fulfillment/billing path;
            // Closed and Cancelled are end states.
            self::NO_SHOW, self::CLOSED, self::CANCELLED => [],
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
     * Whether a trip in this status still ties up its vehicle and driver —
     * the invariant Dispatch's pessimistic lock protects (AGENTS.md
     * "Concurrency (Dispatch)"). Occupancy ends at Trip Completed: the
     * vehicle is physically free the moment the passenger is dropped, even
     * though Invoice Generated / Disputed / Closed still follow on the
     * billing side. Rejected and Cancelled release immediately, and No Show
     * means the journey never happened.
     */
    public function occupiesVehicle(): bool
    {
        return match ($this) {
            self::ASSIGNED, self::ACCEPTED, self::DRIVER_EN_ROUTE, self::DRIVER_ARRIVED,
            self::PASSENGER_ONBOARD, self::TRIP_STARTED, self::WAITING, self::TRIP_RESUMED => true,
            self::REJECTED, self::NO_SHOW, self::TRIP_COMPLETED, self::INVOICE_GENERATED,
            self::DISPUTED, self::CLOSED, self::CANCELLED => false,
        };
    }

    /**
     * @return array<int, string>
     */
    public static function occupyingValues(): array
    {
        return array_map(
            fn (self $status) => $status->value,
            array_filter(self::cases(), fn (self $status) => $status->occupiesVehicle()),
        );
    }
}
