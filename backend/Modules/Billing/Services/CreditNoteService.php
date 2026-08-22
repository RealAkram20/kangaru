<?php

namespace Modules\Billing\Services;

use App\Models\User;
use App\Support\Money\Shillings;
use Brick\Money\Money;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Modules\Billing\Enums\DocumentType;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\CreditNoteLine;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Repositories\InvoiceRepository;

/**
 * Issues credit notes — the only correction mechanism in the module.
 *
 * AGENTS.md Integrity: "Financial mutations are append-only where possible:
 * corrections are credit notes or adjustments, never silent edits to issued
 * invoices." Invoice and InvoiceLine refuse every update at the model
 * level, so there is no editing path for this to compete with.
 *
 * One invariant is enforced here rather than by the database, because no
 * constraint can express it: the sum of every credit note against an
 * invoice may never exceed what that invoice charged. It is checked under
 * the invoice's row lock, so two simultaneous notes cannot each see an
 * uncredited invoice and both pass.
 */
class CreditNoteService
{
    public function __construct(
        private readonly DocumentNumberGenerator $numbers,
        private readonly InvoiceRepository $invoices,
    ) {}

    /**
     * @param  array<int, array{description: string, amount_minor: int, invoice_line_id?: int|null}>  $lines
     *
     * @throws CreditNoteExceedsInvoiceException
     * @throws IdempotencyKeyReusedException
     */
    public function issue(
        Invoice $invoice,
        array $lines,
        string $reason,
        string $idempotencyKey,
        User $actor,
    ): CreditNote {
        $issuedAt = now();

        // The credit note belongs to the **same fleet's series as the invoice
        // it corrects** (ADR-0055 §6). Anything else would file a correction in
        // one company's ledger and the document it corrects in another's.
        //
        // `invoices.operator_id` is nullable — F0 backfilled it and F2 is the
        // pass that starts filling it in — so an invoice raised before this
        // model existed has none. Refused rather than guessed, exactly as
        // `InvoiceService` refuses a trip with no fleet: a credit note is a
        // legal correction to a numbered document, and putting it in the wrong
        // series is worse than not issuing it.
        $operatorId = $invoice->operator_id;

        if ($operatorId === null) {
            throw new \RuntimeException(
                "Invoice {$invoice->id} names no fleet, so no credit-note series can be chosen "
                .'for it (ADR-0055 §6). It predates the fleet model.'
            );
        }

        // Outside the transaction — see DocumentNumberSequenceRepository:
        // creating a counter row inside one deadlocks two simultaneous
        // first-ever documents on its unique index.
        $this->numbers->ensureSeries($operatorId, $invoice->tenant_id, DocumentType::CREDIT_NOTE, $issuedAt);

        return DB::transaction(function () use ($invoice, $operatorId, $lines, $reason, $idempotencyKey, $actor, $issuedAt) {
            // The serialisation point, taken first. Beyond the counter
            // itself, the replay check below is a locking read of a credit
            // note that usually does not exist, and concurrent gap locks on
            // absent rows deadlock the moment both sides insert.
            $this->numbers->lockSeries($operatorId, $invoice->tenant_id, DocumentType::CREDIT_NOTE, $issuedAt);

            // Locks the invoice for the duration. Every credit note against
            // it queues behind this, which is what makes the running-total
            // check below trustworthy.
            /** @var Invoice $locked */
            $locked = Invoice::whereKey($invoice->id)->lockForUpdate()->firstOrFail();

            $replay = $this->replayFor($locked, $idempotencyKey);

            if ($replay !== null) {
                return $replay;
            }

            $total = $this->totalOf($lines);
            $this->assertWithinInvoice($locked, $total);

            return $this->write($locked, $operatorId, $lines, $total, $reason, $idempotencyKey, $actor, $issuedAt);
        });
    }

    /**
     * A replay of the same key against the same invoice returns the
     * original note. The same key against a *different* invoice is a client
     * bug, not a replay — handing back another invoice's credit note would
     * silently answer a question nobody asked.
     *
     * @throws IdempotencyKeyReusedException
     */
    private function replayFor(Invoice $invoice, string $idempotencyKey): ?CreditNote
    {
        // Locking read: a plain one would be answered from this
        // transaction's pre-existing snapshot and could miss a note a
        // competing request has just committed.
        $existing = CreditNote::query()
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();

        if ($existing === null) {
            return null;
        }

        if ($existing->invoice_id !== $invoice->id) {
            throw new IdempotencyKeyReusedException(
                $idempotencyKey,
                "credit note {$existing->credit_note_number} on a different invoice",
            );
        }

        return $existing->load('lines');
    }

    /**
     * @param  array<int, array{description: string, amount_minor: int, invoice_line_id?: int|null}>  $lines
     */
    private function totalOf(array $lines): Money
    {
        return array_reduce(
            $lines,
            fn (Money $carry, array $line) => $carry->plus(Shillings::ofMinor((int) $line['amount_minor'])),
            Shillings::zero(),
        );
    }

    /**
     * @throws CreditNoteExceedsInvoiceException
     */
    private function assertWithinInvoice(Invoice $invoice, Money $requested): void
    {
        $alreadyCredited = $this->invoices->lockedCreditedTotal($invoice->id);

        if ($alreadyCredited->plus($requested)->isGreaterThan($invoice->total())) {
            throw new CreditNoteExceedsInvoiceException($requested, $alreadyCredited, $invoice->total());
        }
    }

    /**
     * @param  int  $operatorId  the invoice's fleet, proved non-null by the
     *                           caller and passed rather than re-read, so the
     *                           note and its number cannot end up in different
     *                           series (ADR-0055 §6)
     * @param  array<int, array{description: string, amount_minor: int, invoice_line_id?: int|null}>  $lines
     */
    private function write(
        Invoice $invoice,
        int $operatorId,
        array $lines,
        Money $total,
        string $reason,
        string $idempotencyKey,
        User $actor,
        CarbonInterface $issuedAt,
    ): CreditNote {
        $note = CreditNote::create([
            'tenant_id' => $invoice->tenant_id,
            'operator_id' => $operatorId,
            'invoice_id' => $invoice->id,
            'credit_note_number' => $this->numbers->next(
                $operatorId,
                $invoice->tenant_id,
                DocumentType::CREDIT_NOTE,
                $issuedAt,
            ),
            'currency' => $invoice->currency,
            'total_minor' => $total,
            'reason' => $reason,
            'idempotency_key' => $idempotencyKey,
            'issued_at' => $issuedAt,
            'issued_by_user_id' => $actor->id,
        ]);

        foreach (array_values($lines) as $index => $line) {
            CreditNoteLine::create([
                'tenant_id' => $invoice->tenant_id,
                'credit_note_id' => $note->id,
                'line_number' => $index + 1,
                'invoice_line_id' => $line['invoice_line_id'] ?? null,
                'description' => $line['description'],
                'amount_minor' => (int) $line['amount_minor'],
            ]);
        }

        return $note->load('lines');
    }
}
