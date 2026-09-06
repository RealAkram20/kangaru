<?php

namespace Modules\Trips\Listeners;

use Modules\Trips\Distance\DistanceResolutionScheduler;
use Modules\Trips\Events\TripCompleted;

/**
 * Trip Completed → a distance resolution, after the grace period (ADR-0045).
 *
 * A listener rather than a call in `TripStateMachine`, so the state machine
 * does not learn about the queue, and so the resolution is scheduled by the
 * same event that already tells Billing and Drivers a trip finished — one
 * moment, one fan-out.
 */
class ScheduleDistanceResolution
{
    public function __construct(private readonly DistanceResolutionScheduler $scheduler) {}

    public function handle(TripCompleted $event): void
    {
        $this->scheduler->afterCompletion($event->trip->id);
    }
}
