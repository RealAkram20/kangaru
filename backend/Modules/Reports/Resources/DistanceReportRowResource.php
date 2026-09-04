<?php

namespace Modules\Reports\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * One trip's latest distance resolution, as the report shows it (ADR-0045).
 *
 * Wraps a query-builder row rather than a model — see
 * `DistanceReportRepository` for why the report is a join — so every field
 * is read and typed here, once, instead of by whoever renders it. The row
 * is read as an array: a builder row is a stdClass whose shape only the
 * repository's select list knows, and the array form says so honestly.
 */
class DistanceReportRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var array<string, mixed> $row */
        $row = (array) $this->resource;

        return [
            'trip_id' => (int) $row['trip_id'],
            'tenant_id' => $row['tenant_id'] === null ? null : (int) $row['tenant_id'],
            'origin' => $row['origin'],
            'destination' => $row['destination'],
            'completed_at' => $this->timestamp($row['completed_at']),
            'driver_name' => $row['driver_name'],
            'vehicle_registration' => $row['vehicle_registration'],
            'resolved_at' => $this->timestamp($row['resolved_at']),
            'policy' => $row['policy'],
            'grade' => $row['grade'],
            'billed_km' => (float) $row['billed_km'],
            'reason' => $row['reason'],
            'odometer_km' => $this->km($row['odometer_km']),
            'gps_km' => $this->km($row['gps_km']),
            'matched_km' => $this->km($row['matched_km']),
            'inferred_km' => $this->km($row['inferred_km']),
            'route_km' => $this->km($row['route_km']),
            'reference_source' => $row['reference_source'],
            'coverage_percent' => $this->km($row['coverage_percent']),
            'inferred_share_percent' => $this->km($row['inferred_share_percent']),
            'pings_total' => (int) $row['pings_total'],
            'pings_kept' => (int) $row['pings_kept'],
            'provider' => $row['provider'],
            'variance_flagged' => (bool) $row['distance_variance_flagged'],
        ];
    }

    private function km(mixed $value): ?float
    {
        return $value === null || ! is_numeric($value) ? null : (float) $value;
    }

    private function timestamp(mixed $value): ?string
    {
        return $value === null ? null : Carbon::parse((string) $value)->toJSON();
    }
}
