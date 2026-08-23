<?php

namespace Modules\Trips\Distance;

/**
 * Everything one resolution produced, before any of it is written
 * (ADR-0045).
 *
 * The replay command prints one of these; the job persists one. Keeping the
 * computing and the writing apart is what lets an operator ask "what would
 * this trip resolve to under today's thresholds" without the answer becoming
 * the trip's answer.
 */
final class ResolutionOutcome
{
    /**
     * @param  array{km: float, source: string}|null  $reference
     */
    public function __construct(
        public readonly MeasuredTrace $trace,
        public readonly ?array $reference,
        public readonly ?float $odometerKm,
        public readonly DistanceWitnesses $witnesses,
        public readonly DistanceDecision $decision,
        public readonly DistanceThresholds $thresholds,
    ) {}
}
