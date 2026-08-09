<?php

namespace Modules\Trips\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Modules\Trips\Services\TripRouteRecorder;

/**
 * The buffer between the ingestion endpoint and MySQL (ADR-0003).
 *
 * The endpoint validates and returns; this writes. That ordering is the
 * whole point of the ADR — GPS ingestion must never make a driver's device
 * wait on the primary database, and the database must never take ~200
 * single-row inserts a second while dispatch and billing are using it.
 *
 * ## What this is not, yet
 *
 * ADR-0003 names a **Redis stream** consumed by a worker. This is Laravel's
 * queue, which is Redis-backed in production via `QUEUE_CONNECTION=redis`,
 * so the architecture the ADR describes — validate, buffer, batch-insert —
 * holds. What is missing is the stream specifically: consumer groups,
 * replay after a crashed worker, and the live latest-position reads that
 * ADR-0003 says must come from Redis rather than MySQL. See
 * Modules/Trips/README.md.
 *
 * Carries ids and plain arrays rather than models: the payload is
 * serialised, and a queued job holding a Trip would re-query it on the way
 * back for no reason.
 */
class RecordTripLocations implements ShouldQueue
{
    use Queueable;

    /**
     * A ping batch is worth retrying — a deadlock or a dropped connection
     * should not lose a chunk of somebody's route — but not forever: the
     * pings are already an hour old by the third attempt and the trip has
     * moved on.
     */
    public int $tries = 3;

    /**
     * @param  array<int, array<string, mixed>>  $pings
     */
    public function __construct(
        private readonly ?int $tenantId,
        private readonly int $tripId,
        private readonly array $pings,
    ) {}

    public function handle(TripRouteRecorder $recorder): void
    {
        $recorder->record($this->tenantId, $this->tripId, $this->pings);
    }
}
