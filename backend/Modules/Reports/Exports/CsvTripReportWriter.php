<?php

namespace Modules\Reports\Exports;

use Modules\Reports\Repositories\TripReportRepository;

class CsvTripReportWriter implements TripReportWriter
{
    public function __construct(
        private readonly TripReportRepository $repository,
        private readonly TripReportRowMapper $mapper,
    ) {}

    /**
     * @param  array<string, mixed>  $filters
     * @param  array<string, mixed>  $summary
     */
    public function write(string $localPath, array $filters, array $summary): int
    {
        $handle = fopen($localPath, 'wb');

        // A failed open must not be written through: every fwrite below
        // would emit a warning and the job would report success against an
        // export file that does not exist.
        if ($handle === false) {
            throw new \RuntimeException("Could not open {$localPath} to write the CSV export.");
        }

        $rows = 0;

        try {
            // UTF-8 BOM: without it Excel on Windows misreads accented
            // characters in the driver and passenger columns, which is
            // where this file is opened most often.
            fwrite($handle, "\xEF\xBB\xBF");

            fputcsv($handle, $this->mapper->headers());

            foreach ($this->repository->chunked($filters) as $chunk) {
                foreach ($chunk as $trip) {
                    fputcsv($handle, $this->mapper->row($trip));
                    $rows++;
                }
            }
        } finally {
            fclose($handle);
        }

        return $rows;
    }
}
