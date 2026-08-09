<?php

namespace Modules\Fleet\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Whether one driver is waiting for work, and where (ADR-0024 §2).
 *
 * A value object rather than a model, for the same reason `LivePosition` is
 * one: it has two possible homes — a `driver_presence` row or a Redis hash —
 * and it is what makes the two stores substitutable. They differ in storage
 * and agree on this.
 */
final class DriverPresence
{
    public function __construct(
        public readonly int $driverId,
        public readonly bool $onDuty,
        public readonly ?int $vehicleId,
        public readonly ?float $latitude,
        public readonly ?float $longitude,
        public readonly ?float $accuracyMetres,
        public readonly ?CarbonInterface $recordedAt,
    ) {}

    /**
     * Seconds since the device said this, or null if it never has.
     *
     * Clamped at zero so a handset with a fast clock reads as "just now"
     * rather than as a negative age — the same clamp `LivePosition` carries,
     * and it is here because the bug it prevents was found there: an
     * unclamped, wrong-signed age made every stale position swear it was
     * fresh.
     */
    public function ageSeconds(): ?int
    {
        if ($this->recordedAt === null) {
            return null;
        }

        return max(0, CarbonImmutable::now()->getTimestamp() - $this->recordedAt->getTimestamp());
    }

    /**
     * Whether this record is too old to act on.
     *
     * A record with no `recorded_at` is stale by definition: the driver went
     * on duty and has never reported a position, so there is nothing to be
     * near. That is not a rejection — see `isDispatchable()` — it only means
     * distance cannot be used.
     */
    public function isStale(): bool
    {
        $age = $this->ageSeconds();

        return $age === null || $age > (int) config('dispatch.presence_ttl_seconds');
    }

    /**
     * Whether the matcher may offer this driver work.
     *
     * On duty, and heard from recently enough to believe. **A driver with no
     * coordinates still qualifies** — location permission can be refused on
     * a handset that is otherwise working perfectly, and refusing that driver
     * work would be a silent, per-driver outage that looks to the office
     * like a matcher preferring some drivers over others for no reason.
     * They rank without a distance component, exactly as ADR-0020 already
     * ranks a booking whose pickup has no coordinates.
     */
    public function isDispatchable(): bool
    {
        if (! $this->onDuty) {
            return false;
        }

        // Position staleness, not presence staleness: what expires is the
        // *place*, and a driver who reported no place has no place to
        // expire. Treating "never sent a position" as "gone offline" would
        // take exactly the location-refused drivers above out of the pool
        // through the back door.
        return $this->latitude === null || ! $this->isStale();
    }

    /** Whether distance to a pickup can be computed from this record. */
    public function hasUsablePosition(): bool
    {
        return $this->latitude !== null && $this->longitude !== null && ! $this->isStale();
    }

    /**
     * @param  array<string, mixed>  $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            driverId: (int) $row['driver_id'],
            // Loose comparison against the string "0", not a cast: Redis
            // hands every hash field back as a string, and `(bool) "0"` is
            // false in PHP but `(bool) "false"` is true. Normalising here
            // keeps that difference out of the two stores.
            onDuty: filter_var($row['on_duty'] ?? false, FILTER_VALIDATE_BOOL),
            // `isset` already excludes null, so each of these is only
            // additionally guarding against the empty string — which is
            // what Redis hands back for a field written as null, and what
            // the database store never produces. Both spellings of "no
            // value" collapse to the same null here so neither store leaks
            // its storage format into the ranking.
            vehicleId: self::present($row, 'vehicle_id') ? (int) $row['vehicle_id'] : null,
            latitude: self::present($row, 'latitude') ? (float) $row['latitude'] : null,
            longitude: self::present($row, 'longitude') ? (float) $row['longitude'] : null,
            accuracyMetres: self::present($row, 'accuracy_metres') ? (float) $row['accuracy_metres'] : null,
            recordedAt: self::present($row, 'recorded_at')
                ? CarbonImmutable::parse((string) $row['recorded_at'])
                : null,
        );
    }

    /**
     * Whether a stored row actually carries a value for this field.
     *
     * The two stores spell "no value" differently — the database returns
     * null, Redis returns the empty string, because a Redis hash holds only
     * strings. Collapsing both here is what keeps that difference out of
     * `isDispatchable()` and out of the ranking, which must not be able to
     * tell which store it is reading from.
     *
     * @param  array<string, mixed>  $row
     */
    private static function present(array $row, string $key): bool
    {
        return isset($row[$key]) && $row[$key] !== '';
    }

    /**
     * @return array<string, mixed>
     */
    public function toRow(): array
    {
        return [
            'driver_id' => $this->driverId,
            'on_duty' => $this->onDuty,
            'vehicle_id' => $this->vehicleId,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'accuracy_metres' => $this->accuracyMetres,
            'recorded_at' => $this->recordedAt?->toDateTimeString(),
        ];
    }
}