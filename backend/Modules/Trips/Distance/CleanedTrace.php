<?php

namespace Modules\Trips\Distance;

/**
 * What survived cleaning, and a tally of what did not (ADR-0045).
 *
 * The tally is not diagnostics; it is evidence. `mock` and `teleport` are
 * inputs to the trust decision in `DistanceResolver`, and every count is
 * written to `trip_distance_evidence.dropped` so a reviewer can see that a
 * trace was graded C because a third of its pings said "fake GPS", not
 * because the resolver felt like it.
 */
final class CleanedTrace
{
    public const REASONS = ['mock', 'accuracy', 'duplicate', 'teleport', 'jitter'];

    /**
     * @param  array<int, TracePoint>  $points  the kept pings, in recorded order
     * @param  array<int, int>  $presence  the recorded-at of every non-mock ping,
     *                                     kept or not, in order — when the
     *                                     handset was demonstrably reporting.
     *                                     A ping dropped for jitter or poor
     *                                     accuracy is a bad *fix*, not a
     *                                     silent device; coverage is about
     *                                     the device.
     * @param  array<string, int>  $dropped  keyed by every value of REASONS, zero where nothing was dropped
     */
    public function __construct(
        public readonly array $points,
        public readonly array $presence,
        public readonly int $total,
        public readonly array $dropped,
    ) {}

    public function kept(): int
    {
        return count($this->points);
    }

    public function droppedFor(string $reason): int
    {
        return $this->dropped[$reason] ?? 0;
    }
}
