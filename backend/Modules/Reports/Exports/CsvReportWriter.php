<?php

namespace Modules\Reports\Exports;

class CsvReportWriter implements ReportWriter
{
    /**
     * @param  array<string, mixed>  $filters
     * @param  array<string, mixed>  $summary
     */
    public function write(ReportSource $source, string $localPath, array $filters, array $summary): int
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

            fputcsv($handle, $source->headers());

            // No summary block: CSV is the format people load into another
            // system, and preamble rows above the header are what make an
            // import fail.
            foreach ($source->rows($filters) as $row) {
                fputcsv($handle, $row);
                $rows++;
            }
        } finally {
            fclose($handle);
        }

        return $rows;
    }
}
