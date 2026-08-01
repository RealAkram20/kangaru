<?php

namespace Modules\Reports\Exports;

use Modules\Reports\Repositories\TripReportRepository;
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
class XlsxTripReportWriter implements TripReportWriter
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
            $writer->addRow(Row::fromValuesWithStyle(['KangaruRide — Trip report'], $bold));
            $writer->addRow(Row::fromValues([$this->period($filters)]));
            $writer->addRow(Row::fromValues($this->summaryLine($summary)));
            $writer->addRow(Row::fromValues([]));

            $writer->addRow(Row::fromValuesWithStyle($this->mapper->headers(), $bold));

            foreach ($this->repository->chunked($filters) as $chunk) {
                foreach ($chunk as $trip) {
                    // Nulls become empty cells rather than the string
                    // "null", which is what an untyped array would give.
                    $writer->addRow(Row::fromValues(array_map(
                        fn ($value) => $value ?? '',
                        $this->mapper->row($trip),
                    )));
                    $rows++;
                }
            }
        } finally {
            $writer->close();
        }

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    private function period(array $filters): string
    {
        $from = self::humanDate($filters['from'] ?? null) ?? 'the beginning';
        $to = self::humanDate($filters['to'] ?? null) ?? 'today';

        return "Trips commencing {$from} to {$to}";
    }

    /**
     * Renders a filter date for the sheet header, or null when it is absent
     * or unparseable. A date the user typed is not guaranteed to parse, and
     * `strtotime` answers false rather than throwing — feeding that straight
     * to `date()` would silently print 1 Jan 1970 on the export.
     */
    private static function humanDate(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }

        $timestamp = is_int($value) ? $value : strtotime($value);

        return $timestamp === false ? null : date('j M Y', $timestamp);
    }

    /**
     * @param  array<string, mixed>  $summary
     * @return array<int, string>
     */
    private function summaryLine(array $summary): array
    {
        $completeness = $summary['completeness_percent'] === null
            ? 'n/a — no completed trips'
            : $summary['completeness_percent'].'% of completed trips carry all six required data points';

        return [
            sprintf(
                '%s trips · %s completed · %s km · %s minutes on the road · %s',
                number_format((int) $summary['trips']),
                number_format((int) $summary['trips_completed']),
                number_format((float) $summary['distance_km'], 2),
                number_format((int) $summary['duration_minutes']),
                $completeness,
            ),
        ];
    }
}
