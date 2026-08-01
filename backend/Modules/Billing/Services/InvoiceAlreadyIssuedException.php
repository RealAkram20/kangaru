<?php

namespace Modules\Billing\Services;

use Modules\Billing\Models\Invoice;

/**
 * An invoice already exists for this trip, and it was not issued under the
 * idempotency key presented.
 *
 * A replay carrying the *same* key is not an error — it returns the
 * original invoice. This is the other case: a genuine second attempt to
 * bill a journey that has already been billed, which AGENTS.md's
 * append-only rule says must be refused rather than duplicated. If the
 * amount was wrong, the correction is a credit note.
 *
 * Surfaces as 409 TRIP_ALREADY_INVOICED.
 */
class InvoiceAlreadyIssuedException extends \RuntimeException
{
    public function __construct(public readonly Invoice $invoice)
    {
        parent::__construct(sprintf(
            'This trip has already been invoiced as %s. An issued invoice is never replaced — '.
            'if the amount needs correcting, issue a credit note against it.',
            $invoice->invoice_number,
        ));
    }
}
