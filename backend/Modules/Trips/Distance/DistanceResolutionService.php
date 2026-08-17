<?php

namespace Modules\Trips\Distance;

use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripDistanceResolved;
use Modules\Trips\Models\DistanceEvidence;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;

/**
 * Runs the whole measured-distance algorithm for one trip and writes the
 * evidence (`docs/measured-distance-plan.md` §2, ADR-0045).
 *
 * `inspect()` computes; `resolve()` computes and persists. The split is
 * deliberate: the replay command and any future "what would this resolve
 * to now" screen use the first, and only the job and the console's force
 * use the second — so looking at a trip never changes it.
 *
 * ## What resolving writes, and what it does not
 *
 * A `trip_distance_evidence` row, and three columns on the trip
 * (`billed_distance_km`, `distance_grade`, `distance_resolved_at`). It does
 * **not** touch `distance_km`, `gps_distance_km` or the variance flag —
 * those keep meaning what they have always meant — and it does not touch a
 * fare. `TripPricingEngine` still reads `distance_km`; pointing it at
 * `billed_distance_km` is Phase 2 and its own decision.
 *
 * ## Policy
 *
 * Every resolution today runs under `GPS_PRIMARY`. The policy will come from
 * the rate card version when billing is wired; the parameter exists so that
 * change is one line here rather than a second code path.
 */
class DistanceResolutionService
{
    public function __construct(
        private readonly TraceLoader $loader,
        private readonly TraceMeasurer $measurer,
        private readonly RouteReference $reference,
        private readonly DistanceResolver $resolver,
        private readonly SettingsService $settings,
    ) {}

    public function inspect(
        Trip $trip,
        DistancePolicy $policy = DistancePolicy::GPS_PRIMARY,
        ?DistanceThresholds $thresholds = null,
    ): ResolutionOutcome {
        $thresholds ??= DistanceThresholds::fromSettings($this->settings);

        $trace = $this->measurer->measure(
            $this->loader->pointsFor($trip->id),
            $trip->started_at?->getTimestamp(),
            $trip->completed_at?->getTimestamp(),
            $thresholds,
        );

        $reference = $this->reference->for($trip, $trace);

        $odometerKm = $trip->odometer_start !== null && $trip->odometer_end !== null
            ? (float) ($trip->odometer_end - $trip->odometer_start)
            : null;

        $witnesses = new DistanceWitnesses(
            odometerKm: $odometerKm,
            gpsKm: $trace->gpsKm,
            coveragePercent: $trace->coveragePercent,
            inferredSharePercent: $trace->inferredSharePercent,
            mockDropped: $trace->cleaned->droppedFor('mock'),
            teleportsDropped: $trace->cleaned->droppedFor('teleport'),
            routeKm: $reference['km'] ?? null,
            stopsDeclared: $this->stopsDeclared($trip),
        );

        return new ResolutionOutcome(
            trace: $trace,
            reference: $reference,
            odometerKm: $odometerKm,
            witnesses: $witnesses,
            decision: $this->resolver->decide($witnesses, $policy, $thresholds),
            thresholds: $thresholds,
        );
    }

    /**
     * Resolves and records. Only a completed trip has anything to resolve;
     * anything else returns null and writes nothing.
     */
    public function resolve(Trip $trip, DistancePolicy $policy = DistancePolicy::GPS_PRIMARY): ?DistanceEvidence
    {
        if ($trip->status !== TripStatus::TRIP_COMPLETED) {
            return null;
        }

        $outcome = $this->inspect($trip, $policy);
        $trace = $outcome->trace;
        $decision = $outcome->decision;

        $evidence = DB::transaction(function () use ($trip, $outcome, $trace, $decision) {
            $evidence = DistanceEvidence::create([
                'tenant_id' => $trip->tenant_id,
                'trip_id' => $trip->id,
                'resolved_at' => now(),
                'policy' => $decision->policy,
                'grade' => $decision->grade,
                'billed_km' => $decision->billedKm,
                'reason' => mb_substr($decision->reason, 0, 255),
                'odometer_km' => $outcome->odometerKm,
                'gps_km' => $trace->gpsKm,
                'matched_km' => $trace->gpsKm === null ? null : round($trace->matchedKm, 2),
                'inferred_km' => $trace->gpsKm === null ? null : round($trace->inferredKm, 2),
                'haversine_km' => $trace->cleaned->kept() >= 2 ? round($trace->haversineKm, 2) : null,
                'route_km' => $outcome->reference['km'] ?? null,
                'reference_source' => $outcome->reference['source'] ?? null,
                'coverage_percent' => $trace->coveragePercent,
                'inferred_share_percent' => $trace->inferredSharePercent,
                'pings_total' => $trace->cleaned->total,
                'pings_kept' => $trace->cleaned->kept(),
                'gaps_routed' => $trace->gapsRouted,
                'dropped' => $trace->cleaned->dropped,
                'provider' => $trace->provider,
                // A JSON list of encoded polylines, one per matching, rather
                // than one polyline: encoded polylines are delta-coded from
                // their own origin and cannot be concatenated as strings.
                'matched_polyline' => $trace->polylines === [] ? null : json_encode($trace->polylines),
                'thresholds' => $outcome->thresholds->toArray(),
            ]);

            $trip->forceFill([
                'billed_distance_km' => $decision->billedKm,
                'distance_grade' => $decision->grade,
                'distance_resolved_at' => $evidence->resolved_at,
            ])->save();

            return $evidence;
        });

        TripDistanceResolved::dispatch($trip, $evidence);

        return $evidence;
    }

    /**
     * Whether the driver declared a stop — a Waiting period — during the
     * trip. Read from the timeline, tenant-scope-free for the reason
     * `TripEvent::scopeForTrip` gives.
     */
    private function stopsDeclared(Trip $trip): bool
    {
        return TripEvent::query()
            ->forTrip($trip)
            ->where('to_status', TripStatus::WAITING)
            ->exists();
    }
}
