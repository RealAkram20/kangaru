<?php

namespace Modules\Reports\Exports;

use Barryvdh\DomPDF\Facade\Pdf;
use Modules\Reports\Enums\ExportFormat;

/**
 * The presentation format — what gets attached to an email or handed across
 * a table, rather than reconciled in a spreadsheet.
 *
 * Unlike CSV and XLSX this is not streamed: dompdf assembles the whole
 * document in memory before rendering. That is why ExportFormat::PDF
 * declares a row ceiling and requests above it are refused up front with an
 * explanation, instead of a queued job dying halfway through.
 */
class PdfReportWriter implements ReportWriter
{
    /**
     * @param  array<string, mixed>  $filters
     * @param  array<string, mixed>  $summary
     */
    public function write(ReportSource $source, string $localPath, array $filters, array $summary): int
    {
        $limit = ExportFormat::PDF->rowLimit() ?? PHP_INT_MAX;
        $rows = [];

        foreach ($source->rows($filters) as $row) {
            $rows[] = $row;

            // Belt and braces: the request is refused before queueing, but
            // a report can grow between being asked for and being built.
            if (count($rows) > $limit) {
                throw new \RuntimeException(
                    'This report grew beyond the '.number_format($limit).
                    '-row limit for PDF while it was queued. Narrow the range and try again, '.
                    'or export it as CSV or Excel.'
                );
            }
        }

        $pdf = Pdf::loadView('reports.table-pdf', [
            'title' => $source->title(),
            // The <h1> drops the "KangaruRide — " prefix the <title> keeps:
            // the brand is already on the page furniture, and repeating it
            // in the heading wastes the widest line on the document.
            'heading' => str_replace('KangaruRide — ', '', $source->title()),
            'period' => $source->period($filters),
            'headers' => $source->headers(),
            'rows' => $rows,
            'summaryCells' => $source->summaryCells($summary),
            'emptyMessage' => $source->emptyMessage(),
            'generatedAt' => now(),
        ])->setPaper('a4', 'landscape');

        file_put_contents($localPath, $pdf->output());

        return count($rows);
    }
}
