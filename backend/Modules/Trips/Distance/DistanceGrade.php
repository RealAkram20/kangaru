<?php

namespace Modules\Trips\Distance;

/**
 * How far a trip's billed distance can be trusted (ADR-0045).
 *
 * Three grades, and the third is the one that matters: A and B bill
 * automatically, C is held for a person. The names are deliberately not
 * "good / ok / bad" — B is a perfectly billable trip whose trace disagreed
 * with the map's opinion of the road, and calling that "ok" invites somebody
 * to treat it as a problem.
 */
enum DistanceGrade: string
{
    /** Measured, and the road agrees. The invoice line says "GPS-verified". */
    case VERIFIED = 'A';

    /**
     * Bounded. Either a measured trace that strayed from the reference (a
     * detour, or a road the map lacks), or an odometer reading that sat
     * inside the corridor the reference allows. Billed, and logged.
     */
    case BOUNDED = 'B';

    /**
     * Held. The evidence does not support a figure: the odometer had to be
     * clamped to the corridor, or there was no trace and no reference to
     * check it against. Nothing bills from this until a person clears it.
     */
    case HELD = 'C';

    public function label(): string
    {
        return match ($this) {
            self::VERIFIED => 'GPS-verified',
            self::BOUNDED => 'bounded',
            self::HELD => 'held for review',
        };
    }

    public function billable(): bool
    {
        return $this !== self::HELD;
    }
}
