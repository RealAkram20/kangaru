<?php

namespace Modules\Reports\Repositories;

use App\Support\Money\Shillings;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Reports\Enums\FinancialPeriod;

/**
 * The financial report: what was invoiced and what was credited, bucketed
 * into periods.
 *
 * A repository on both of ADR-0002's counts — "non-trivial queries (joins,
 * aggregates, geospatial, reporting)" and "anything touching billing,
 * invoicing, or payments (isolation aids auditing and testing)".
 *
 * ## Two queries merged, never joined
 *
 * Invoices and credit notes are separate documents with separate dates.
 * Joining them to total both in one pass would repeat an invoice's amount
 * once per credit note raised against it — the classic fan-out, and on a
 * financial aggregate it does not look like a duplicated row, it looks
 * like a larger figure. Merging two independently-grouped result sets by
 * bucket key cannot do that.
 *
 * ## Which period a credit note falls in
 *
 * Its own `issued_at`, not that of the invoice it corrects. A credit note
 * raised in August against a July invoice belongs to August: that is when
 * the correction was made, when it hit the ledger, and when a finance user
 * reconciling August will look for it. The consequence is that a row is a
 * statement about *activity in that period*, not about the eventual fate
 * of the invoices raised in it — see the README, which states this on the
 * report itself rather than leaving a reader to infer it.
 *
 * ## Tenancy
 *
 * Both queries go through the Eloquent models, so ADR-0001's TenantScope
 * applies. A raw DB::table('invoices') here would sum every tenant's money
 * into one client's report, which for a bank client is the worst bug this
 * platform can have — and it would be invisible, because a leak in an
 * aggregate is not a stray row, it is a bigger number.
 */
class FinancialActivityRepository
{
    /**
     * One row per period in which anything was invoiced or credited,
     * oldest first.
     *
     * Ordered ascending, unlike the fleet reports' "busiest first": a
     * ledger is read forwards, and a running total that goes backwards in
     * time is not one a finance user can follow down the page.
     *
     * @param  array<string, mixed>  $filters
     * @return Collection<int, FinancialPeriodRow>
     */
    public function byPeriod(array $filters): Collection
    {
        $period = FinancialPeriod::fromFilters($filters);

        $invoiced = $this->bucket(Invoice::query(), $period, $filters);
        $credited = $this->bucket(CreditNote::query(), $period, $filters);

        // The union of both sets of keys. Taking the invoice buckets alone
        // would silently drop a period in which nothing was invoiced but
        // something was credited — which is precisely a period a finance
        // user needs to see, because the ledger moved and no invoice
        // explains it.
        $buckets = $invoiced->keys()
            ->merge($credited->keys())
            ->unique()
            ->sort()
            ->values();

        return $buckets->map(function (string $bucket) use ($invoiced, $credited): FinancialPeriodRow {
            $issued = $invoiced->get($bucket);
            $notes = $credited->get($bucket);

            return new FinancialPeriodRow(
                bucket: $bucket,
                invoiceCount: $issued === null ? 0 : (int) $issued->documents,
                invoiced: Shillings::ofMinor($issued === null ? 0 : (int) $issued->total_minor),
                creditNoteCount: $notes === null ? 0 : (int) $notes->documents,
                credited: Shillings::ofMinor($notes === null ? 0 : (int) $notes->total_minor),
            );
        });
    }

    /**
     * Counts and totals for one document type, keyed by period bucket.
     *
     * @param  Builder<Invoice>|Builder<CreditNote>  $query
     * @param  array<string, mixed>  $filters
     * @return Collection<string, \stdClass>
     */
    private function bucket(Builder $query, FinancialPeriod $period, array $filters): Collection
    {
        // Both tables carry `issued_at` and `total_minor`, which is what
        // makes one method serve both. They are the two facts every
        // financial document in this platform has.
        $expression = $period->sqlExpression('issued_at');

        return $query
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('issued_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('issued_at', '<=', $to))
            ->groupByRaw($expression)
            ->selectRaw("{$expression} as bucket")
            ->selectRaw('COUNT(*) as documents')
            // COALESCE is defensive rather than necessary — a group only
            // exists because a row is in it — but it costs nothing and
            // means the cast below can never be handed a null.
            ->selectRaw('COALESCE(SUM(total_minor), 0) as total_minor')
            // toBase(): these rows are aggregates, not Invoices. Hydrating
            // them into a model would apply MoneyMinorCast to a SUM and
            // produce an object whose `id` is absent and whose columns are
            // totals — an invitation to a bug. It still applies global
            // scopes, so TenantScope is not lost.
            ->toBase()
            ->get()
            ->keyBy('bucket');
    }
}
