<?php

namespace Modules\Billing\Services;

use Brick\Money\Money;

/**
 * The credit note would take more off an invoice than the invoice ever
 * charged.
 *
 * The invariant is on the *total credited across every credit note*, not on
 * one note in isolation: three plausible notes that together exceed the
 * invoice are the realistic way this goes wrong, not one obviously
 * oversized one. CreditNoteService checks the running total under the
 * invoice's row lock for exactly that reason.
 *
 * Surfaces as 422 CREDIT_NOTE_EXCEEDS_INVOICE.
 */
class CreditNoteExceedsInvoiceException extends \RuntimeException
{
    public function __construct(
        public readonly Money $requested,
        public readonly Money $alreadyCredited,
        public readonly Money $invoiceTotal,
    ) {
        parent::__construct(sprintf(
            'This credit note cannot be issued because it would credit more than the invoice charged. '.
            'The invoice is %s, %s has already been credited, and this note is for %s. '.
            'Reduce it to %s or less.',
            $invoiceTotal->getAmount(),
            $alreadyCredited->getAmount(),
            $requested->getAmount(),
            $invoiceTotal->minus($alreadyCredited)->getAmount(),
        ));
    }
}
