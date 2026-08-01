<?php

namespace Modules\Reports\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\Trip;

/**
 * One row of the trip report — the Bank's six acceptance criteria plus the
 * identifiers needed to trace a row back to its trip.
 *
 * Deliberately flatter than TripResource: a report row is read across, and
 * nesting the vehicle and driver objects would push the registration
 * number and driver name a level down from where a reader expects them.
 *
 * @mixin Trip
 */
class TripReportRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $duration = $this->durationMinutes();

        return [
            'trip_id' => $this->id,
            'booking_id' => $this->booking_id,
            'status' => $this->status->value,
            // 1. Date and time of commencement and completion.
            'commenced_at' => $this->started_at,
            'completed_at' => $this->completed_at,
            // 2. Vehicle registration details.
            'vehicle_registration' => $this->vehicle?->registration_number,
            'vehicle_description' => $this->vehicle
                ? trim($this->vehicle->make.' '.$this->vehicle->model)
                : null,
            'driver_name' => $this->driver?->name,
            // 3. Trip origin and destination.
            'origin' => $this->origin,
            'destination' => $this->destination,
            // 4. Opening and closing odometer readings.
            'odometer_start' => $this->odometer_start,
            'odometer_end' => $this->odometer_end,
            // 5. Total distance travelled.
            'distance_km' => $this->distance_km,
            // 6. Trip duration.
            'duration_minutes' => $duration,
            // Lets the UI flag a row that cannot satisfy the acceptance
            // criteria, instead of showing blanks the reader must notice.
            'is_complete' => $this->completed_at !== null
                && $this->odometer_start !== null
                && $this->odometer_end !== null
                && $this->distance_km !== null,
        ];
    }
}
