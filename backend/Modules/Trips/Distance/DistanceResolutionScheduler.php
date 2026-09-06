<?php

namespace Modules\Trips\Distance;

use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Jobs\ResolveTripDistance;

/**
 * When a trip's distance gets (re)resolved (ADR-0045).
 *
 * Two triggers, one job:
 *
 * - **Completion.** `TripCompleted` → `afterCompletion()` → the job, delayed
 *   by `tracking.resolution_grace_seconds` so the last ping batches have
 *   time to land.
 * - **Late pings.** `RecordTripLocations` → `afterPings()` → the job again,
 *   with the same delay, but only if the trip has already completed. Pings
 *   for a trip still in progress schedule nothing; its completion will.
 *
 * `ResolveTripDistance` is unique per trip, so a burst of late batches
 * schedules one run, not one per batch.
 */
class DistanceResolutionScheduler
{
    public function __construct(private readonly SettingsService $settings) {}

    public function afterCompletion(int $tripId): void
    {
        $this->schedule($tripId);
    }

    /**
     * Called from the ingestion job with an id rather than a model, because
     * that is all it has. The status read is tenant-scope-free for the same
     * reason `TripRouteRecorder::updateLivePosition()`'s is: keyed on a trip
     * id already resolved by the request, running on the queue with no
     * tenant bound.
     */
    public function afterPings(int $tripId): void
    {
        $status = DB::table('trips')->where('id', $tripId)->value('status');

        if ($status !== TripStatus::TRIP_COMPLETED->value) {
            return;
        }

        $this->schedule($tripId);
    }

    private function schedule(int $tripId): void
    {
        $grace = (int) $this->settings->get('tracking', 'resolution_grace_seconds');

        ResolveTripDistance::dispatch($tripId)->delay(now()->addSeconds($grace));
    }
}
