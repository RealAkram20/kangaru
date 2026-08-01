<?php

namespace Modules\Billing\Repositories;

use App\Support\Money\Shillings;
use Brick\Money\Money;
use Illuminate\Database\Eloquent\Builder;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;

/**
 * Invoice queries that need to be right rather than merely convenient.
 *
 * ADR-0002 requires a repository for "anything touching billing, invoicing,
 * or payments (isolation aids auditing and testing)". These three methods
 * each earn it: two of them exist specifically to force a *current* read
 * under a row lock rather than a snapshot read, which is a distinction no
 * caller should have to remember.
 *
 * Everything here goes through the Invoice/CreditNote models, so ADR-0001's
 * TenantScope applies. A raw query would silently cross tenants, and on a
 * financial total that is the worst bug this platform can have.
 */
class InvoiceRepository
{
    /**
     * @param  array<string, mixed>  $filters
     * @return Builder<Invoice>
     */
    public function listing(array $filters): Builder
    {
        return Invoice::query()
            ->with(['trip:id,origin,destination,started_at,completed_at,distance_km', 'lines'])
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('issued_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('issued_at', '<=', $to))
            ->when($filters['trip_id'] ?? null, fn ($q, $id) => $q->where('trip_id', $id))
            ->when(
                $filters['invoice_number'] ?? null,
                fn ($q, $number) => $q->where('invoice_number', $number)
            )
            ->orderByDesc('issued_at')
            ->orderByDesc('id');
    }

    /**
     * The invoice already issued for a trip, read under a row lock.
     *
     * The lock is not optional decoration. InvoiceService opens its
     * transaction with a plain read, which under MySQL's REPEATABLE READ
     * fixes a snapshot from *before* a competing generator committed. A
     * locking read is a current read: it sees the competitor's committed
     * invoice and is therefore the only version of this question whose
     * answer can be trusted inside the transaction.
     *
     * MUST be called inside a transaction.
     */
    public function lockExistingForTrip(int $tripId): ?Invoice
    {
        return Invoice::query()
            ->where('trip_id', $tripId)
            ->lockForUpdate()
            ->first();
    }

    /**
     * Whether this idempotency key has already been spent, read under a
     * lock for the same reason as above.
     *
     * MUST be called inside a transaction.
     */
    public function lockExistingForIdempotencyKey(string $key): ?Invoice
    {
        return Invoice::query()
            ->where('idempotency_key', $key)
            ->lockForUpdate()
            ->first();
    }

    /**
     * How much has already been credited against an invoice, summed from
     * the credit notes under a current read.
     *
     * CreditNoteService compares this against the invoice total before
     * writing, so the sum must not come from a stale snapshot — two
     * concurrent credit notes each seeing "nothing credited yet" is exactly
     * how an invoice ends up over-credited.
     *
     * MUST be called inside a transaction.
     */
    public function lockedCreditedTotal(int $invoiceId): Money
    {
        $notes = CreditNote::query()
            ->where('invoice_id', $invoiceId)
            ->lockForUpdate()
            ->get(['id', 'total_minor']);

        return $notes->reduce(
            fn (Money $carry, CreditNote $note) => $carry->plus($note->total()),
            Shillings::zero(),
        );
    }
}
