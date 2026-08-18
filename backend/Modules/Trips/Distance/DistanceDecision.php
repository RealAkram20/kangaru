<?php

namespace Modules\Trips\Distance;

/**
 * The resolver's answer: a figure, a grade, and one sentence saying why
 * (ADR-0045).
 *
 * `reason` is prose on purpose. The grade is reconstructible from the
 * evidence row's columns; the sentence is what a reviewer reads in the queue
 * and what a driver is shown when they dispute a fare, and "clamped to
 * corridor" beats a code they have to look up.
 */
final class DistanceDecision
{
    public function __construct(
        public readonly float $billedKm,
        public readonly DistanceGrade $grade,
        public readonly DistancePolicy $policy,
        public readonly string $reason,
        /** Whether the trace met every bar for being billed as measured. */
        public readonly bool $traceTrusted,
    ) {}
}
