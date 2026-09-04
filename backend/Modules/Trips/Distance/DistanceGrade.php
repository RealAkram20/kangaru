<?php

namespace Modules\Trips\Distance;

/**
 * How far a trip's billed distance can be trusted (ADR-0045).
 *
 * Four grades. A and B bill automatically. C is held for a person: the
 * evidence *contradicts* the figure, or a reading had to be clamped to fit
 * the road. U is the fourth, and it is the difference between a watchdog
 * and a gate: **no evidence either way** — no usable trace and no reference
 * route, so nothing vouches for the odometer and nothing contradicts it.
 * ADR-0035 refused to flag such a trip ("that is missing evidence, not a
 * discrepancy — flagging it would flag every trip taken before a device was
 * fitted"), and the same principle holds here: under the odometer policy an
 * unverified trip bills as it always did; under a trace-priced policy it is
 * held, because the contract asked to be billed on something that was not
 * measured. `DistanceGate` makes that call; the grade only names the state.
 *
 * The names are deliberately not "good / ok / bad" — B is a perfectly
 * billable trip whose trace disagreed with the map's opinion of the road,
 * and calling that "ok" invites somebody to treat it as a problem.
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
     * Held. The evidence speaks against the figure: a trusted trace
     * contradicts the odometer, or the odometer had to be clamped to the
     * road's corridor, or the witness a contract named is missing. Nothing
     * bills from this until a person clears it.
     */
    case HELD = 'C';

    /**
     * Unverified. No usable trace and no reference route: nothing vouches
     * for the odometer, nothing contradicts it. Bills under the odometer
     * policy as it always did; held under a trace-priced one.
     */
    case UNVERIFIED = 'U';

    public function label(): string
    {
        return match ($this) {
            self::VERIFIED => 'GPS-verified',
            self::BOUNDED => 'bounded',
            self::HELD => 'held for review',
            self::UNVERIFIED => 'unverified',
        };
    }

    /**
     * Whether the grade alone stops billing. U is not decided here — it
     * depends on the policy, which is `DistanceGate`'s question.
     */
    public function billable(): bool
    {
        return $this !== self::HELD;
    }
}
