<?php

namespace Modules\Trips\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Where one vehicle is, and how long ago it said so (ADR-0019).
 *
 * A value object rather than a model, because it has two possible homes —
 * a `live_positions` row or a Redis hash — and neither should leak into the
 * thing a map renders. It is also what makes the two drivers substitutable:
 * they differ in storage and agree on this.
 */
final class LivePosition
{
    public function __construct(
        public readonly int $vehicleId,
        public readonly ?int $tenantId,
        public readonly int $tripId,
        public readonly ?int $driverId,
        public readonly float $latitude,
        public readonly float $longitude,
        public readonly ?float $speedKph,
        public readonly ?int $headingDegrees,
        public readonly CarbonInterface $recordedAt,
    ) {}

    /**
     * Seconds since the device recorded this.
     *
     * The number PROJECT.md's "<15 s freshness" is measured against, and the
     * one a dispatcher actually needs: a marker sitting still is ambiguous
     * until you know whether it is a parked vehicle or a dead phone.
     */
    public function ageSeconds(): int
    {
        // Plain timestamps rather than `diffInSeconds`, because the sign
        // convention is the easy thing to get backwards and did get
        // backwards here: `$recordedAt->diffInSeconds(now())` already
        // returns a positive number for a past instant, and negating it
        // made every position report an age of zero — a stale marker
        // that swore it was fresh, which is the one lie this field exists
        // to prevent.
        //
        // Clamped at zero so a device with a fast clock reads as "just
        // now" rather than as a negative age.
        return max(0, CarbonImmutable::now()->getTimestamp() - $this->recordedAt->getTimestamp());
    }

    public function isStale(): bool
    {
        return $this->ageSeconds() > (int) config('tracking.live_stale_after_seconds');
    }

    /**
     * @param  array<string, mixed>  $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            vehicleId: (int) $row['vehicle_id'],
            tenantId: isset($row['tenant_id']) ? (int) $row['tenant_id'] : null,
            tripId: (int) $row['trip_id'],
            driverId: isset($row['driver_id']) ? (int) $row['driver_id'] : null,
            latitude: (float) $row['latitude'],
            longitude: (float) $row['longitude'],
            speedKph: isset($row['speed_kph']) ? (float) $row['speed_kph'] : null,
            headingDegrees: isset($row['heading_degrees']) ? (int) $row['heading_degrees'] : null,
            recordedAt: CarbonImmutable::parse((string) $row['recorded_at']),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toRow(): array
    {
        return [
            'vehicle_id' => $this->vehicleId,
            'tenant_id' => $this->tenantId,
            'trip_id' => $this->tripId,
            'driver_id' => $this->driverId,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'speed_kph' => $this->speedKph,
            'heading_degrees' => $this->headingDegrees,
            'recorded_at' => $this->recordedAt->toDateTimeString(),
        ];
    }
}
