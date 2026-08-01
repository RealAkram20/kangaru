<?php

namespace Modules\Reports\Exports;

/**
 * Writes the trip report to a local file in one format.
 *
 * Local, not straight to the storage disk, because the production disk is
 * Cloudflare R2 (PROJECT.md) which has no writable stream a spreadsheet or
 * PDF library can append to. The job writes locally, uploads the finished
 * file, and deletes the temporary copy.
 */
interface TripReportWriter
{
    /**
     * @param  array<string, mixed>  $filters  whitelisted report filters
     * @param  array<string, mixed>  $summary  totals for the same filtered set
     * @return int rows written, excluding headers
     */
    public function write(string $localPath, array $filters, array $summary): int;
}
