<?php

namespace Modules\Reports\Services;

use Modules\Reports\Repositories\TripReportRepository;
use Modules\Trips\Models\Trip;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CSV export of the trip report.
 *
 * Streamed rather than assembled in memory: the report is the artifact the
 * anchor client reconciles their invoices against, so it has to stay
 * correct at a month's volume, not just a demo's.
 *
 * AGENTS.md wants reports generated asynchronously via a queue. This is a
 * synchronous stream, which is why EXPORT_ROW_LIMIT exists — see
 * Modules/Reports/README.md. Beyond the cap the request is refused with a
 * clear message instead of quietly truncating, because a silently short
 * report is a billing dispute.
 */
class TripReportCsv
{
    /**
     * Chosen to stay well inside PHP's default max_execution_time at the
     * observed per-row cost, with headroom. Raise it only alongside the
     * queued exporter, not on its own.
     */
    public const EXPORT_ROW_LIMIT = 50_000;

    /**
     * Column order matches the Bank's six acceptance criteria (PROJECT.md),
     * in the order they are listed there, with identifiers first.
     *
     * @var array<int, string>
     */
    private const HEADERS = [
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
    ];

    public function __construct(private readonly TripReportRepository $repository) {}

    /**
     * @param  array<string, mixed>  $filters
     */
    public function stream(array $filters, string $filename): StreamedResponse
    {
        return response()->stream(
            function () use ($filters) {
                $handle = fopen('php://output', 'wb');

                // UTF-8 BOM: without it Excel on Windows misreads accented
                // names in the driver and passenger columns, which is where
                // this file is opened most often.
                fwrite($handle, "\xEF\xBB\xBF");

                fputcsv($handle, self::HEADERS);

                foreach ($this->repository->chunked($filters) as $chunk) {
                    foreach ($chunk as $trip) {
                        fputcsv($handle, $this->row($trip));
                    }

                    flush();
                }

                fclose($handle);
            },
            200,
            [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => 'attachment; filename="'.$filename.'"',
                // The row count is not known before streaming starts, so
                // the browser cannot show progress; say so rather than
                // sending a wrong Content-Length.
                'X-Accel-Buffering' => 'no',
            ],
        );
    }

    /**
     * @return array<int, string|int|float|null>
     */
    private function row(Trip $trip): array
    {
        $duration = $trip->durationMinutes();

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
        ];
    }
}
