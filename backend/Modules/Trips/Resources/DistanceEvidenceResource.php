<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\DistanceEvidence;

/**
 * One resolution of a trip's distance, for the console's evidence panel and
 * review queue (ADR-0045).
 *
 * @mixin DistanceEvidence
 */
class DistanceEvidenceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'resolved_at' => $this->resolved_at->toIso8601String(),
            'policy' => $this->policy->value,
            'grade' => $this->grade->value,
            'grade_label' => $this->grade->label(),
            'billed_km' => (float) $this->billed_km,
            'reason' => $this->reason,
            'odometer_km' => $this->km($this->odometer_km),
            'gps_km' => $this->km($this->gps_km),
            'matched_km' => $this->km($this->matched_km),
            'inferred_km' => $this->km($this->inferred_km),
            'haversine_km' => $this->km($this->haversine_km),
            'route_km' => $this->km($this->route_km),
            'reference_source' => $this->reference_source,
            'coverage_percent' => $this->km($this->coverage_percent),
            'inferred_share_percent' => $this->km($this->inferred_share_percent),
            'pings_total' => $this->pings_total,
            'pings_kept' => $this->pings_kept,
            'gaps_routed' => $this->gaps_routed,
            'dropped' => $this->dropped,
            'provider' => $this->provider,
            // A JSON list of encoded polylines, one per matching — see
            // `DistanceResolutionService`. Decoded by the map, not here.
            'matched_polylines' => $this->matched_polyline === null
                ? []
                : (array) json_decode($this->matched_polyline, true),
            'thresholds' => $this->thresholds,
        ];
    }

    private function km(?string $value): ?float
    {
        return $value === null ? null : (float) $value;
    }
}
