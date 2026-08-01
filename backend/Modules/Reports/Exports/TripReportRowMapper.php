<?php

namespace Modules\Reports\Exports;

use Modules\Trips\Models\Trip;

/**
 * The single definition of a trip report's columns.
 *
 * CSV, XLSX and PDF all render from this. Three writers each with their own
 * column list would drift, and the format a client happened to open would
 * decide whether they saw all six of the Bank's data points — so the shape
 * is defined once and the writers only decide how to draw it.
 */
class TripReportRowMapper
{
    /**
     * Column order follows PROJECT.md's list of the six criteria, with
     * identifiers first.
     *
     * @return array<int, string>
     */
    public function headers(): array
    {
        return [
            'Trip ID',
            'Booking ID',
            'Status',
            'Commenced at',
            'Completed at',
            'Vehicle registration',
            'Vehicle',
            'Driver',
            'Origin',
            'Destination',
            'Opening odometer (km)',
            'Closing odometer (km)',
            'Distance travelled (km)',
            'Duration (minutes)',
            'Duration (h:mm)',
            'Record complete',
        ];
    }

    /**
     * @return array<int, string|int|float|null>
     */
    public function row(Trip $trip): array
    {
        $duration = $trip->durationMinutes();

        $complete = $trip->completed_at !== null
            && $trip->odometer_start !== null
            && $trip->odometer_end !== null
            && $trip->distance_km !== null;

        return [
            $trip->id,
            $trip->booking_id,
            $trip->status->value,
            $trip->started_at?->toDateTimeString(),
            $trip->completed_at?->toDateTimeString(),
            $trip->vehicle?->registration_number,
            $trip->vehicle ? trim($trip->vehicle->make.' '.$trip->vehicle->model) : null,
            $trip->driver?->name,
            $trip->origin,
            $trip->destination,
            $trip->odometer_start,
            $trip->odometer_end,
            $trip->distance_km,
            $duration,
            $duration === null ? null : sprintf('%d:%02d', intdiv($duration, 60), $duration % 60),
            // Spelled out rather than a bare boolean: this column is read
            // by a person in a spreadsheet, and "1"/"0" invites the wrong
            // reading. A trip still on the road is not a deficient record.
            $trip->completed_at === null ? 'In progress' : ($complete ? 'Yes' : 'No'),
        ];
    }
}
