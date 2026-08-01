<?php

namespace Modules\Billing\Repositories;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Modules\Billing\Enums\DocumentType;

/**
 * Allocates the next number in a tenant's document series under a row lock.
 *
 * AGENTS.md Integrity: "Invoice numbers are sequential per tenant,
 * generated inside a transaction with a locked counter row. Gaps and
 * duplicates are both audit findings for bank clients."
 *
 * A repository rather than a service because ADR-0001 confines raw,
 * scope-free queries to repositories, and ADR-0002 requires one for
 * "anything touching billing, invoicing, or payments" anyway. It is not a
 * CRUD proxy: the locking is the work.
 *
 * ## Why creating the row is a separate step
 *
 * The obvious implementation — insert the counter row if absent, then lock
 * it, all in one transaction — deadlocks under exactly the load it exists
 * to survive. Two simultaneous first-ever invoices both issue
 * `INSERT IGNORE`; one wins the unique index, the other must take a shared
 * lock on the winner's uncommitted row to decide whether it is a duplicate,
 * and does so while already holding an insert-intention lock the winner
 * needs. MySQL breaks the cycle by killing one:
 *
 *     SQLSTATE[40001]: Serialization failure: 1213 Deadlock found ...
 *     insert ignore into `document_number_sequences` ...
 *
 * That was observed, not theorised — `tests/Concurrency/InvoiceNumberRaceTest.php`
 * reported it on the first run. So `ensureSeries()` is called *before* the
 * transaction opens, where each `INSERT IGNORE` is its own autocommitted
 * statement holding no other locks and therefore cannot form a cycle.
 * `lockSeries()` and `allocate()` then only ever touch a row that already
 * exists.
 */
class DocumentNumberSequenceRepository
{
    /**
     * Creates the counter row for a series if it does not exist yet.
     *
     * MUST be called *outside* the transaction that will consume a number —
     * see the class docblock. Not asserted with a `transactionLevel()`
     * check, because RefreshDatabase wraps every feature test in a
     * transaction and the assertion would fail everywhere it does not
     * matter; the concurrency suite, which is where it does matter, runs
     * without one.
     *
     * Safe to call repeatedly: the unique index on
     * (tenant_id, document_type, year) makes every call after the first a
     * no-op.
     */
    public function ensureSeries(int $tenantId, DocumentType $type, int $year): void
    {
        // Raw, tenant-scope-free query with tenant_id written explicitly —
        // the ADR-0001 repository exception. `document_number_sequences` is
        // not an Eloquent-modelled entity: it is a counter, and the only
        // things that ever touch it are the three statements in this class.
        DB::table('document_number_sequences')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'document_type' => $type->value,
            'year' => $year,
            'next_number' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Takes the exclusive lock on a tenant's counter row and returns the
     * number that would be issued next, without consuming it.
     *
     * Callers take this *first*, before anything else in the transaction.
     * That is not only about the counter: everything else invoice
     * generation touches — the invoice for a trip, the invoice for an
     * idempotency key — is a row that does not exist yet, and locking
     * reads on absent rows take gap locks that two concurrent generators
     * would then deadlock on the moment both tried to insert. Serialising
     * on the counter first means only one generation per tenant is ever in
     * flight, so nothing downstream is contended at all.
     *
     * Per-tenant serialisation is the correct trade here rather than a
     * regrettable one: a gapless sequence is inherently serial, and
     * invoicing is a month-end batch, not a request hot path.
     *
     * MUST be called inside a transaction. `lockForUpdate()` outside one is
     * released immediately and buys nothing — the same trap
     * TripAssignmentGuard guards against, and for the same reason.
     */
    public function lockSeries(int $tenantId, DocumentType $type, int $year): int
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                'Document number sequences must be locked inside a transaction; lockForUpdate outside one is a no-op.'
            );
        }

        $row = $this->query($tenantId, $type, $year)->lockForUpdate()->first();

        // ensureSeries() guarantees the row. If it is gone, something
        // deleted a counter mid-flight and continuing would reissue numbers
        // that are already on issued invoices.
        if ($row === null) {
            throw new \RuntimeException(
                "Document number sequence for tenant {$tenantId} ({$type->value}, {$year}) does not exist. ".
                'ensureSeries() must be called before the transaction opens.'
            );
        }

        return (int) $row->next_number;
    }

    /**
     * Consumes and returns this tenant's next number in the series.
     *
     * Re-takes the lock rather than trusting the caller to hold it: a
     * transaction that already owns the row gets it for free, and one that
     * forgot is corrected rather than left to allocate unserialised.
     *
     * MUST be called inside a transaction.
     */
    public function allocate(int $tenantId, DocumentType $type, int $year): int
    {
        $number = $this->lockSeries($tenantId, $type, $year);

        $this->query($tenantId, $type, $year)
            ->update(['next_number' => $number + 1, 'updated_at' => now()]);

        return $number;
    }

    private function query(int $tenantId, DocumentType $type, int $year): Builder
    {
        return DB::table('document_number_sequences')
            ->where('tenant_id', $tenantId)
            ->where('document_type', $type->value)
            ->where('year', $year);
    }
}
