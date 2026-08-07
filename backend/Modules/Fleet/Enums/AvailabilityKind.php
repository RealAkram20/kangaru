<?php

namespace Modules\Fleet\Enums;

/**
 * Why a driver or vehicle is off the road (ADR-0017 §2).
 *
 * The kind is not decoration: `Modules/Reports` will want utilisation split
 * by cause — a fleet losing days to maintenance has a different problem
 * from one losing them to leave — and a free-text reason cannot be grouped.
 * The reason field stays, for the sentence a person needs; this is the part
 * a query can count.
 */
enum AvailabilityKind: string
{
    // Drivers
    case LEAVE = 'leave';
    case SICK = 'sick';
    case REST = 'rest';
    case TRAINING = 'training';

    // Vehicles
    case MAINTENANCE = 'maintenance';
    case INSPECTION = 'inspection';
    case REPAIR = 'repair';

    // Either
    case OTHER = 'other';

    /**
     * @return array<int, self>
     */
    public static function forResource(AvailabilityResource $resource): array
    {
        return match ($resource) {
            AvailabilityResource::DRIVER => [self::LEAVE, self::SICK, self::REST, self::TRAINING, self::OTHER],
            AvailabilityResource::VEHICLE => [self::MAINTENANCE, self::INSPECTION, self::REPAIR, self::OTHER],
        };
    }

    /**
     * @return array<int, string>
     */
    public static function valuesForResource(AvailabilityResource $resource): array
    {
        return array_map(fn (self $kind) => $kind->value, self::forResource($resource));
    }

    /**
     * The sentence a dispatcher sees when this is what stands in the way.
     *
     * Deliberately not the raw enum value. "sick" against a driver's name on
     * a shared board says more about a colleague's health than a dispatcher
     * needs to make a dispatch decision; "Not available" plus the dates is
     * the operational fact. The specific kind stays queryable for the people
     * who are supposed to see it.
     */
    public function dispatchNote(): string
    {
        return match ($this) {
            self::MAINTENANCE, self::INSPECTION, self::REPAIR => 'Off the road for '.$this->value.'.',
            default => 'Not available.',
        };
    }
}
