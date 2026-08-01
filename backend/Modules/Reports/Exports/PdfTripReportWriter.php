<?php

namespace Modules\Reports\Exports;

use Barryvdh\DomPDF\Facade\Pdf;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Repositories\TripReportRepository;

/**
 * The presentation format — what gets attached to an email or handed across
 * a table, rather than reconciled in a spreadsheet.
 *
 * Unlike CSV and XLSX this is not streamed: dompdf assembles the whole
 * document in memory before rendering. That is why ExportFormat::PDF
 * declares a row ceiling and requests above it are refused up front with an
 * explanation, instead of a queued job dying halfway through.
 */
class PdfTripReportWriter implements TripReportWriter
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
        $rows = [];

        foreach ($this->repository->chunked($filters) as $chunk) {
            foreach ($chunk as $trip) {
                $rows[] = $this->mapper->row($trip);

                // Belt and braces: the controller refuses an oversized
                // request before queuing, but a report can grow between
                // being requested and being generated.
                if (count($rows) > (ExportFormat::PDF->rowLimit() ?? PHP_INT_MAX)) {
                    throw new \RuntimeException(
                        'This report grew beyond the '.number_format(ExportFormat::PDF->rowLimit()).
                        '-trip limit for PDF while it was queued. Narrow the range and try again, '.
                        'or export it as CSV or Excel.'
                    );
                }
            }
        }

        $pdf = Pdf::loadView('reports.trips-pdf', [
            'headers' => $this->mapper->headers(),
            'rows' => $rows,
            'summary' => $summary,
            'filters' => $filters,
            'generatedAt' => now(),
        ])->setPaper('a4', 'landscape');

        file_put_contents($localPath, $pdf->output());

        return count($rows);
    }
}
