<?php

namespace Modules\Reports\Exports;

use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;

/**
 * A real Excel workbook, not a CSV renamed.
 *
 * openspout rather than PhpSpreadsheet: it writes row by row to disk, so
 * memory stays flat at a month's volume. PhpSpreadsheet holds the whole
 * sheet in memory, which is the exact failure this queued exporter exists
 * to avoid.
 */
class XlsxReportWriter implements ReportWriter
{
    /**
     * @param  array<string, mixed>  $filters
     * @param  array<string, mixed>  $summary
     */
    public function write(ReportSource $source, string $localPath, array $filters, array $summary): int
    {
        $writer = new Writer;
        $writer->openToFile($localPath);

        $rows = 0;

        try {
            // openspout 5 made Style immutable: constructor arguments and
            // with*() clones, not the setFontBold() setters of earlier
            // majors.
            $bold = new Style(fontBold: true);

            // fromValuesWithStyle, not fromValues: the second argument of
            // fromValues is row height, not a style.
            $writer->addRow(Row::fromValuesWithStyle([$source->title()], $bold));
            $writer->addRow(Row::fromValues([$source->period($filters)]));
            $writer->addRow(Row::fromValues([$this->summaryLine($source, $summary)]));
            $writer->addRow(Row::fromValues([]));

            $writer->addRow(Row::fromValuesWithStyle($source->headers(), $bold));

            foreach ($source->rows($filters) as $row) {
                // Nulls become empty cells rather than the string "null",
                // which is what an untyped array would give.
                $writer->addRow(Row::fromValues(array_map(fn ($value) => $value ?? '', $row)));
                $rows++;
            }
        } finally {
            $writer->close();
        }

        return $rows;
    }

    /**
     * The summary as one readable sentence above the table.
     *
     * Built from the source's own label/value pairs, so a report that adds
     * a figure gets it here without touching this writer.
     *
     * @param  array<string, mixed>  $summary
     */
    private function summaryLine(ReportSource $source, array $summary): string
    {
        return implode(' · ', array_map(
            fn (array $cell) => $cell['label'].': '.$cell['value'],
            $source->summaryCells($summary),
        ));
    }
}
