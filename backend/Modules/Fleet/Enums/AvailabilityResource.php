<?php

namespace Modules\Fleet\Enums;

use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * What an availability block can be about (ADR-0017 §2).
 *
 * A closed enum rather than Laravel's polymorphic `morphTo`. The set is two
 * and will stay small, the values are the words an operator would use, and
 * a fully-qualified class name in a database column is a refactor away from
 * breaking every historical row — the failure mode `morphMap` exists to
 * paper over. This is the map, and it is type-checked.
 */
enum AvailabilityResource: string
{
    case DRIVER = 'driver';
    case VEHICLE = 'vehicle';

    /**
     * @return class-string<Driver|Vehicle>
     */
    public function modelClass(): string
    {
        return match ($this) {
            self::DRIVER => Driver::class,
            self::VEHICLE => Vehicle::class,
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::DRIVER => 'Driver',
            self::VEHICLE => 'Vehicle',
        };
    }

    /**
     * Whether a resource of this kind exists.
     *
     * Used by validation so a block cannot be recorded against an id that
     * names nothing — an unavailability nobody can see, permanently
     * blocking nothing.
     */
    public function exists(int $id): bool
    {
        return $this->modelClass()::query()->whereKey($id)->exists();
    }
}
