<?php

namespace Modules\Billing\Services;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Modules\Billing\Enums\DocumentType;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\InvoiceLine;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Pricing\DistanceGate;
use Modules\Billing\Pricing\PricedLine;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Billing\Repositories\InvoiceRepository;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripStateMachine;

/**
 * The only path that issues an invoice.
 *
 * Everything AGENTS.md demands of invoice generation happens inside one
 * transaction here, because these facts must be true together or not at
 * all: the number came from the locked counter, the lines record the inputs
 * that produced them, the rate card version is sealed against further
 * editing, and the trip has moved to Invoice Generated. A crash between any
 * two of those leaves a bank client with a discrepancy nobody can explain.
 *
 * Idempotency (AGENTS.md Integrity: "every mutation carries an idempotency
 * key; replays return the original result, never a duplicate") is enforced
 * in three layers, deliberately:
 *
 *   1. A locking read of the trip's existing invoice — correct under
 *      concurrency, and the layer that actually returns the replay.
 *   2. A unique index on (tenant_id, idempotency_key), and another on
 *      trip_id. These hold even if a future caller bypasses this service.
 *   3. The trip's own state machine: a trip already at Invoice Generated
 *      is no longer at Trip Completed and cannot be billed again.
 */
class InvoiceService
{
    public function __construct(
        private readonly RateCardResolver $rateCards,
        private readonly TripPricingEngine $pricing,
        private readonly DocumentNumberGenerator $numbers,
        private readonly InvoiceRepository $invoices,
        private readonly TripStateMachine $trips,
        private readonly DistanceGate $distances,
    ) {}

    /**
     * Issues the invoice for a completed trip, or returns the one already
     * issued under this idempotency key.
     *
     * Note for callers: the trip moves to Invoice Generated on this
     * service's own locked re-read of the row, so the `$trip` instance you
     * passed in still holds its previous status afterwards. Call
     * `$trip->refresh()` before using it again.
     *
     * @throws WalkInTripNotInvoiceableException the trip has no client to bill (ADR-0024)
     * @throws TripNotInvoiceableException the trip is not at Trip Completed
     * @throws InvoiceAlreadyIssuedException the trip is billed, under a different key
     * @throws IdempotencyKeyReusedException the key belongs to another trip's invoice
     * @throws RateCardNotConfiguredException nothing prices this trip
     */
    public function generateForTrip(Trip $trip, string $idempotencyKey, User $actor, ?RateCard $rateCard = null): Invoice
    {
        // First, before anything reads the tenant (ADR-0024).
        //
        // A walk-in trip has none, and the very next statement would either
        // create a document number series belonging to nobody or fail on an
        // integrity constraint three layers down — surfacing to whoever
        // pressed Invoice as a database error about counters.
        //
        // Asked as "is there a client" rather than `$trip->isWalkIn()`,
        // even though the ADR-0024 §1 invariant makes the two equivalent.
        // Every use below is of the tenant specifically — the number
        // series, the ledger row, the whole billing scope is per client —
        // so the absence of a tenant is the precise thing that blocks this,
        // and naming it is what lets the reader (and the analyser) see that
        // nothing beyond this line can be holding a null.
        $tenantId = $trip->tenant_id;

        if ($tenantId === null) {
            throw new WalkInTripNotInvoiceableException($trip);
        }

        // The fleet that did the work, and therefore the fleet whose invoice
        // series this document belongs to (ADR-0055 §6).
        //
        // Taken from the trip, which `TripService` stamps from the assigned
        // driver — not from the Finance officer generating the invoice, who
        // could belong to a different fleet once Kangaru can act as one
        // (ADR-0056), and not from the request context, which is unbound on
        // any queued or scheduled path.
        $operatorId = $trip->operator_id;

        if ($operatorId === null) {
            // A corporate trip with no fleet is a row F0 backfilled and
            // nothing has since stamped, or one created down a path that
            // never named a driver. Either way the honest answer to "whose
            // invoice series is this?" is that nobody knows, and guessing
            // would put a number in one fleet's ledger and the work in
            // another's.
            throw new \RuntimeException(
                "Trip {$trip->id} names no fleet, so no invoice series can be chosen for it "
                .'(ADR-0055 §6). It predates the fleet model or was created without a driver.'
            );
        }

        $issuedAt = now();

        // Outside the transaction, deliberately: creating the counter row
        // inside it makes two simultaneous first-ever invoices deadlock on
        // its unique index. Observed, not theorised — see
        // DocumentNumberSequenceRepository.
        $this->numbers->ensureSeries($operatorId, $tenantId, DocumentType::INVOICE, $issuedAt);

        return DB::transaction(function () use ($trip, $tenantId, $operatorId, $idempotencyKey, $actor, $rateCard, $issuedAt) {
            // The serialisation point, and the first statement in the
            // transaction. Everything below reads or writes rows that do
            // not exist yet, and locking reads on absent rows take gap
            // locks that two concurrent generators deadlock on as soon as
            // both insert. Holding the tenant's counter first means only
            // one generation per tenant is ever in flight.
            $this->numbers->lockSeries($operatorId, $tenantId, DocumentType::INVOICE, $issuedAt);

            // Serialises every generator working on this trip specifically.
            /** @var Trip $locked */
            $locked = Trip::whereKey($trip->id)->lockForUpdate()->firstOrFail();

            $replay = $this->replayOrRefuse($locked, $idempotencyKey);

            if ($replay !== null) {
                return $replay;
            }

            if ($locked->status !== TripStatus::TRIP_COMPLETED) {
                throw new TripNotInvoiceableException($locked);
            }

            return $this->issue($locked, $tenantId, $operatorId, $idempotencyKey, $actor, $rateCard, $issuedAt);
        });
    }

    /**
     * Decides what an already-seen trip or key means: a replay to return, a
     * conflict to refuse, or neither.
     *
     * Both reads are locking reads via InvoiceRepository. A plain read here
     * would be answered from the transaction's REPEATABLE READ snapshot,
     * which was fixed before a competing generator committed — it would
     * report "no invoice yet" and this method would wave a duplicate
     * through.
     *
     * @throws InvoiceAlreadyIssuedException
     * @throws IdempotencyKeyReusedException
     */
    private function replayOrRefuse(Trip $trip, string $idempotencyKey): ?Invoice
    {
        $existing = $this->invoices->lockExistingForTrip($trip->id);

        if ($existing !== null) {
            if ($existing->idempotency_key === $idempotencyKey) {
                return $existing->load('lines');
            }

            throw new InvoiceAlreadyIssuedException($existing);
        }

        $keyHolder = $this->invoices->lockExistingForIdempotencyKey($idempotencyKey);

        if ($keyHolder !== null) {
            throw new IdempotencyKeyReusedException(
                $idempotencyKey,
                "invoice {$keyHolder->invoice_number} on trip #{$keyHolder->trip_id}",
            );
        }

        return null;
    }

    /**
     * @param  int  $tenantId  the client being billed, proved non-null by the
     *                         caller's walk-in guard (ADR-0024) — passed rather
     *                         than re-read off the trip so that proof travels
     *                         with it instead of having to be repeated here
     * @param  int  $operatorId  the fleet whose driver ran the trip, proved
     *                           non-null by the caller for the same reason and
     *                           passed the same way (ADR-0055 §6)
     *
     * @throws RateCardNotConfiguredException
     */
    private function issue(
        Trip $trip,
        int $tenantId,
        int $operatorId,
        string $idempotencyKey,
        User $actor,
        ?RateCard $rateCard,
        CarbonInterface $issuedAt,
    ): Invoice {
        $version = $this->rateCards->resolveFor($trip, $rateCard);

        // ADR-0045 §2: a trace-priced contract does not invoice an unresolved
        // trip, and no contract invoices a held one. Refused here, inside the
        // lock and before a number is drawn, so a refusal costs no sequence
        // gap.
        $this->distances->assertBillable($trip, $version);

        $price = $this->pricing->price($trip, $version);

        $invoice = Invoice::create([
            'tenant_id' => $tenantId,
            'operator_id' => $operatorId,
            'invoice_number' => $this->numbers->next($operatorId, $tenantId, DocumentType::INVOICE, $issuedAt),
            'trip_id' => $trip->id,
            'rate_card_version_id' => $version->id,
            'currency' => $version->currency,
            'total_minor' => $price->total(),
            'idempotency_key' => $idempotencyKey,
            'issued_at' => $issuedAt,
            'issued_by_user_id' => $actor->id,
        ]);

        foreach ($price->lines as $index => $line) {
            $this->writeLine($invoice, $line, $index + 1);
        }

        // From here the version can never be edited (RateCardVersion
        // refuses every other update). Sealing it inside this transaction
        // means an issued invoice and the frozen prices it cites become
        // permanent together.
        $version->lock();

        // The trip's own record of being billed. Routed through the state
        // machine rather than written directly so the transition is
        // validated and lands in the append-only trip_events timeline like
        // every other one.
        $this->trips->transition($trip, TripStatus::INVOICE_GENERATED, $actor);

        return $invoice->load('lines');
    }

    private function writeLine(Invoice $invoice, PricedLine $line, int $lineNumber): void
    {
        InvoiceLine::create([
            'tenant_id' => $invoice->tenant_id,
            'invoice_id' => $invoice->id,
            ...$line->toLineAttributes($lineNumber),
        ]);
    }
}
