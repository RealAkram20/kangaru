<?php

namespace Modules\Reports\Exports;

/**
 * Everything a writer needs to render a report, and nothing about how.
 *
 * The three writers (CSV, XLSX, PDF) used to depend on the trip repository
 * and the trip row mapper directly, which meant a second report needed a
 * second set of writers — and three more places for the column list to
 * drift. They now depend on this instead, so adding a report is one class
 * rather than four.
 *
 * Rows are yielded rather than returned: a month of trips is tens of
 * thousands of rows, and CSV and XLSX both write straight to disk without
 * ever holding the set in memory.
 */
interface ReportSource
{
    /** Shown as the document heading — "KangaruRide — Driver report". */
    public function title(): string;

    /**
     * The single definition of this report's columns. Every format renders
     * from it, so the format a client happens to open cannot change which
     * columns they see.
     *
     * @return array<int, string>
     */
    public function headers(): array;

    /**
     * @param  array<string, mixed>  $filters  already whitelisted by the request
     * @return \Generator<int, array<int, string|int|float|null>>
     */
    public function rows(array $filters): \Generator;

    /**
     * Headline figures for the same filtered set, rendered above the table
     * in XLSX and PDF.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters): array;

    /**
     * The summary rendered as label/value pairs for the XLSX and PDF
     * headers.
     *
     * Formatting lives with the source rather than in the writers because
     * only the source knows what its own figures mean — that a null
     * completeness percentage must read "n/a" and never an invented 100%,
     * for one. A writer given a raw array would have to guess.
     *
     * @param  array<string, mixed>  $summary  the output of summary()
     * @return array<int, array{label: string, value: string}>
     */
    public function summaryCells(array $summary): array;

    /**
     * Describes the filtered period on the document — "Trips commencing
     * 1 Jul 2026 to 31 Jul 2026".
     *
     * @param  array<string, mixed>  $filters
     */
    public function period(array $filters): string;

    /** Shown in place of the table when the filtered set is empty. */
    public function emptyMessage(): string;

    /**
     * How many rows the filtered set holds, without building them.
     *
     * Used before queueing, so a PDF request beyond its row ceiling is
     * refused with an explanation rather than dying halfway through a job.
     *
     * @param  array<string, mixed>  $filters
     */
    public function count(array $filters): int;
}
