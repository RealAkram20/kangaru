<?php

namespace Modules\Reports\Exports;

use App\Support\Money\Shillings;
use Brick\Money\Money;
use Modules\Reports\Enums\FinancialPeriod;
use Modules\Reports\Repositories\FinancialActivityRepository;
use Modules\Reports\Repositories\FinancialPeriodRow;
use Modules\Reports\Support\ReportScope;

/**
 * PROJECT.md's fourth Phase 1 report: invoiced, credited and outstanding
 * per period.
 *
 * The first report in this module that reads Modules/Billing rather than
 * Modules/Trips, and the first whose rows are periods rather than things.
 * Neither mattered to the pipeline it plugs into: implementing ReportSource
 * is the whole of the work, and the CSV, XLSX and PDF writers, the row
 * ceiling check and the queued export job all picked it up unchanged.
 *
 * ## "Outstanding" means issued less credited
 *
 * Nothing in this platform records money coming in — payments, statements
 * and credit limits are all deferred (Modules/Billing/README.md, deferred
 * item 1). So "outstanding" here cannot mean "unpaid", and a bank reading
 * it as such would be reading a number the system is not able to produce.
 *
 * That is stated in three places rather than one, on purpose: in the
 * `payments_recorded` flag on the JSON summary, as a Basis line in the
 * XLSX and PDF headers, and as a hint under the on-screen tile. A caveat
 * that only exists in a tooltip is a caveat that is absent from the
 * document someone actually files.
 */
class FinancialReportSource implements ReportSource
{
    public function __construct(
        private readonly FinancialActivityRepository $repository,
        private readonly ReportScope $scope,
    ) {}

    public function title(): string
    {
        return 'KangaruRide — Financial report';
    }

    /**
     * The Period column is named "Period" for all four granularities rather
     * than "Month"/"Week"/"Day"/"Year".
     *
     * ReportSource::headers() takes no filters — deliberately, because the
     * column list is what every format and the on-screen table share, and
     * making it vary per request would mean a client could not cache or
     * compare it. The granularity is stated in period() instead, which is
     * rendered directly above the table on both documents that have a
     * header.
     *
     * @return array<int, string>
     */
    public function headers(): array
    {
        $currency = Shillings::currency();

        return [
            'Period',
            'Invoices',
            "Invoiced ({$currency})",
            'Credit notes',
            "Credited ({$currency})",
            "Net ({$currency})",
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return \Generator<int, array<int, string|int|float|null>>
     */
    public function rows(array $filters): \Generator
    {
        $period = FinancialPeriod::fromFilters($filters);

        foreach ($this->repository->byPeriod($filters, $this->scope) as $row) {
            yield [
                $period->label($row->bucket),
                $row->invoiceCount,
                // Whole shillings, as a number rather than a formatted
                // string: this column is summed in a spreadsheet, and
                // "UGX 1,250,000" in a cell is a value nobody can add up.
                //
                // Minor units are exact here because Phase 1 is UGX, which
                // is zero-decimal — one minor unit is one shilling
                // (AGENTS.md Money & Billing Standards). Multi-currency is
                // deferred platform-wide; when it lands this is one of the
                // places that has to divide, and the README says so.
                Shillings::toMinor($row->invoiced),
                $row->creditNoteCount,
                Shillings::toMinor($row->credited),
                Shillings::toMinor($row->net()),
            ];
        }
    }

    /**
     * Headline figures over the whole filtered range.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function summary(array $filters): array
    {
        $rows = $this->repository->byPeriod($filters, $this->scope);

        $invoiced = $rows->reduce(
            fn (Money $carry, FinancialPeriodRow $row) => $carry->plus($row->invoiced),
            Shillings::zero(),
        );

        $credited = $rows->reduce(
            fn (Money $carry, FinancialPeriodRow $row) => $carry->plus($row->credited),
            Shillings::zero(),
        );

        return [
            'periods' => $rows->count(),
            'invoices' => $rows->sum(fn (FinancialPeriodRow $row) => $row->invoiceCount),
            'invoiced_minor' => Shillings::toMinor($invoiced),
            'credit_notes' => $rows->sum(fn (FinancialPeriodRow $row) => $row->creditNoteCount),
            'credited_minor' => Shillings::toMinor($credited),
            'outstanding_minor' => Shillings::toMinor($invoiced->minus($credited)),
            'currency' => Shillings::currency(),
            // Part of the contract, not a UI concern. A client reading
            // `outstanding_minor` needs to know what it does not account
            // for, and the day payments exist this flips here rather than
            // leaving a stale caveat hardcoded in a frontend file.
            'payments_recorded' => false,
        ];
    }

    /**
     * @param  array<string, mixed>  $summary
     * @return array<int, array{label: string, value: string}>
     */
    public function summaryCells(array $summary): array
    {
        $currency = is_string($summary['currency'] ?? null)
            ? $summary['currency']
            : Shillings::currency();

        $money = fn (string $key): string => $currency.' '.number_format((int) $summary[$key]);

        return [
            ['label' => 'Invoices', 'value' => number_format((int) $summary['invoices'])],
            ['label' => 'Invoiced', 'value' => $money('invoiced_minor')],
            ['label' => 'Credit notes', 'value' => number_format((int) $summary['credit_notes'])],
            ['label' => 'Credited', 'value' => $money('credited_minor')],
            ['label' => 'Outstanding', 'value' => $money('outstanding_minor')],
            // Not decoration, and not droppable. Every other figure on this
            // document is a fact about documents issued; this one says what
            // the figure above it does *not* account for. A bank handed a
            // page headed "Outstanding" will otherwise assume payments were
            // netted off, and nothing else on the page would correct them.
            [
                'label' => 'Basis',
                'value' => $summary['payments_recorded'] === true
                    ? 'Issued less credited and less payments received'
                    : 'Issued less credited; payments are not yet recorded',
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function period(array $filters): string
    {
        $granularity = FinancialPeriod::fromFilters($filters);

        // "issued", not "commencing": this report is about documents, and
        // the date it filters on is when each was raised. Reusing the trip
        // reports' verb would imply it followed trips.
        return ReportPeriod::describe($filters, 'Invoices and credit notes issued')
            .', by '.$granularity->noun();
    }

    public function emptyMessage(): string
    {
        return 'No invoice or credit note was issued in this period.';
    }

    /**
     * The number of period rows, which is what the PDF ceiling applies to.
     *
     * Bucketing makes this small by construction — a year grouped daily is
     * 366 rows — so this report will not meet the ceiling that the
     * row-per-trip report can. It is still checked, because the check
     * belongs to the pipeline rather than to any one report.
     *
     * @param  array<string, mixed>  $filters
     */
    public function count(array $filters): int
    {
        return $this->repository->byPeriod($filters, $this->scope)->count();
    }
}
