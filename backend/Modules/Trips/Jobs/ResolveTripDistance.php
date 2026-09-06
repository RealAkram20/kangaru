<?php

namespace Modules\Trips\Jobs;

use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Modules\Trips\Distance\DistanceResolutionService;
use Modules\Trips\Models\Trip;

/**
 * Resolves one completed trip's distance, later rather than now (ADR-0045).
 *
 * ## Why a job, and why delayed
 *
 * The completion request cannot do this itself. Pings reach `trip_locations`
 * through `RecordTripLocations` on the queue, and the completion arrives
 * through the handset's outbox — often *before* the last batch of pings, and
 * sometimes an hour before, from a basement car park. Measuring at the moment
 * of completion measures whatever happens to have landed. So
 * `DistanceResolutionScheduler` dispatches this with a grace delay, and
 * dispatches it again whenever pings arrive for a trip that has already
 * completed; each run appends a new evidence row and the trip's figure
 * reflects the latest.
 *
 * ## Why unique
 *
 * A device draining a day's outbox posts a dozen batches in a minute, and
 * each would schedule a resolution. `ShouldBeUnique` collapses them: while
 * one resolution for this trip is queued or running, further dispatches are
 * dropped, and the one that runs sees every batch that landed before it. A
 * batch landing *after* it starts dispatches a fresh one, which is exactly
 * the re-run wanted.
 *
 * Carries an id, not a model: the trip is re-read when the job runs, which
 * is the whole point of the delay.
 */
class ResolveTripDistance implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /**
     * Worth retrying — an OSRM hiccup or a deadlock should not leave a trip
     * unresolved — but the resolver never throws on a routing failure, so
     * a third failure is a bug, not weather.
     */
    public int $tries = 3;

    /**
     * How long the uniqueness lock outlives a dispatch that never ran. Longer
     * than any grace period the settings allow, so a delayed job is never
     * duplicated while it waits; short enough that a lost job does not
     * silence a trip for the day.
     */
    public int $uniqueFor = 7200;

    public function __construct(public readonly int $tripId) {}

    public function uniqueId(): string
    {
        return (string) $this->tripId;
    }

    public function handle(DistanceResolutionService $resolution): void
    {
        // No actor on the queue, so no tenant is bound and `TenantScope`
        // would fail closed — `allTenants()` is the reviewed opt-out for
        // exactly this case (BelongsToTenant docblock).
        $trip = Trip::allTenants()->find($this->tripId);

        if ($trip === null) {
            Log::info('distance.resolution_skipped', ['trip_id' => $this->tripId, 'reason' => 'trip not found']);

            return;
        }

        $evidence = $resolution->resolve($trip);

        if ($evidence === null) {
            Log::info('distance.resolution_skipped', ['trip_id' => $this->tripId, 'reason' => 'trip not completed']);

            return;
        }

        Log::info('distance.resolved', [
            'trip_id' => $trip->id,
            'grade' => $evidence->grade->value,
            'billed_km' => $evidence->billed_km,
            'provider' => $evidence->provider,
        ]);
    }
}
