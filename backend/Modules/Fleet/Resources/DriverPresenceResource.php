<?php

namespace Modules\Fleet\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Fleet\Support\DriverPresence;

/**
 * A driver's own duty state, as their app sees it (ADR-0024 §2).
 *
 * @mixin DriverPresence
 */
class DriverPresenceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var DriverPresence $presence */
        $presence = $this->resource;

        return [
            'driver_id' => $presence->driverId,
            'on_duty' => $presence->onDuty,
            'vehicle_id' => $presence->vehicleId,
            'latitude' => $presence->latitude,
            'longitude' => $presence->longitude,
            'recorded_at' => $presence->recordedAt?->toIso8601String(),

            // Whether the matcher would offer this driver work right now.
            //
            // Served rather than left for the app to derive, because the
            // rule is "on duty, and either heard from within the TTL or
            // never able to report a position at all" — three conditions
            // and a configured number. A client re-deriving that would
            // drift from the matcher, and the symptom would be an app
            // saying "you're online" to a driver the system is not offering
            // anything to. This is the same reasoning that serves
            // `allowed_transitions` instead of duplicating the lifecycle.
            'dispatchable' => $presence->isDispatchable(),

            // Null when they have never reported. Lets the app say "last
            // seen 4 minutes ago" rather than showing a green dot it has
            // no evidence for.
            'position_age_seconds' => $presence->ageSeconds(),

            // How often to report in, from config rather than compiled into
            // the app — so the cadence can be tuned against real battery
            // data without shipping a new build to every handset.
            'heartbeat_seconds' => (int) config('dispatch.presence_heartbeat_seconds'),
        ];
    }
}