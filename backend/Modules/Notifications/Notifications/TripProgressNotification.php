<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Trips\Models\Trip;

/**
 * "Your car is assigned" · "your driver has arrived" · "your trip is
 * complete" — the three moments the person who booked a car wants to hear
 * about after their request was approved. One class, three types, because
 * the sentence differs and nothing else does.
 *
 * Addressed to the booking's requester — a corporate client's employee.
 * A walk-in trip has no booking and its rider is told by the customer
 * flow, so the factories return null and the listener sends nothing.
 *
 * Frozen at dispatch (subject and body are stored as text, ADR-0032): what
 * somebody was told does not change when the trip does. The completion
 * body carries the letter's six data points — that is the record the
 * client is billed by, and the requester should hold it the moment it
 * exists.
 */
class TripProgressNotification extends KangaruNotification
{
    /**
     * @param  array<string, mixed>  $facts
     */
    public function __construct(
        private readonly NotificationType $type,
        private readonly int $tripId,
        private readonly int $bookingId,
        private readonly string $origin,
        private readonly string $destination,
        private readonly array $facts,
    ) {}

    public static function assigned(Trip $trip): ?self
    {
        return self::build(NotificationType::TRIP_ASSIGNED, $trip);
    }

    public static function driverArrived(Trip $trip): ?self
    {
        return self::build(NotificationType::TRIP_DRIVER_ARRIVED, $trip);
    }

    public static function completed(Trip $trip): ?self
    {
        return self::build(NotificationType::TRIP_COMPLETED, $trip);
    }

    private static function build(NotificationType $type, Trip $trip): ?self
    {
        if ($trip->booking_id === null) {
            return null;
        }

        $trip->loadMissing(['vehicle', 'driver']);

        return new self($type, $trip->id, (int) $trip->booking_id, $trip->origin, $trip->destination, [
            'registration' => $trip->vehicle?->registration_number,
            'vehicle' => $trip->vehicle ? trim("{$trip->vehicle->make} {$trip->vehicle->model}") : null,
            // First name only: the requester needs to recognise the person
            // at the kerb, not hold their record (docs/screen-rules.md §2).
            'driver_first_name' => $trip->driver ? explode(' ', trim($trip->driver->name))[0] : null,
            'started_at' => $trip->started_at?->toIso8601String(),
            'completed_at' => $trip->completed_at?->toIso8601String(),
            'odometer_start' => $trip->odometer_start,
            'odometer_end' => $trip->odometer_end,
            'distance_km' => $trip->distance_km,
            'duration_minutes' => $trip->durationMinutes(),
        ]);
    }

    public function type(): NotificationType
    {
        return $this->type;
    }

    public function subject(): string
    {
        return match ($this->type) {
            NotificationType::TRIP_ASSIGNED => "Booking #{$this->bookingId}: vehicle assigned",
            NotificationType::TRIP_DRIVER_ARRIVED => "Booking #{$this->bookingId}: your driver has arrived",
            default => "Booking #{$this->bookingId}: trip completed",
        };
    }

    public function body(): string
    {
        $route = "{$this->origin} to {$this->destination}";
        $car = $this->facts['registration']
            ? trim(($this->facts['vehicle'] ? $this->facts['vehicle'].' ' : '')."({$this->facts['registration']})")
            : 'a vehicle';
        $driver = $this->facts['driver_first_name'] ? " with {$this->facts['driver_first_name']} driving" : '';

        return match ($this->type) {
            NotificationType::TRIP_ASSIGNED => "{$car}{$driver} has been assigned to your transport request from {$route}.",
            NotificationType::TRIP_DRIVER_ARRIVED => "Your driver{$driver} has arrived at {$this->origin} in {$car}.",
            default => $this->completionBody($route, $car),
        };
    }

    private function completionBody(string $route, string $car): string
    {
        $distance = $this->facts['distance_km'] !== null
            ? number_format((float) $this->facts['distance_km'], 1).' km'
            : 'distance not recorded';
        $minutes = $this->facts['duration_minutes'];
        $duration = $minutes === null
            ? 'duration not recorded'
            : ($minutes < 60 ? "{$minutes} min" : intdiv($minutes, 60).'h '.($minutes % 60).'m');
        $odometer = $this->facts['odometer_start'] !== null && $this->facts['odometer_end'] !== null
            ? number_format($this->facts['odometer_start']).' to '.number_format($this->facts['odometer_end'])
            : 'odometer reading missing';

        return "Your trip from {$route} in {$car} is complete: {$distance}, {$duration}, odometer {$odometer}. "
            .'The full record, with the dashboard photographs, is on the trip page.';
    }

    public function url(): ?string
    {
        return "/trips/{$this->tripId}";
    }

    public function context(): array
    {
        return [
            'trip_id' => $this->tripId,
            'booking_id' => $this->bookingId,
            'origin' => $this->origin,
            'destination' => $this->destination,
            ...$this->facts,
        ];
    }
}
