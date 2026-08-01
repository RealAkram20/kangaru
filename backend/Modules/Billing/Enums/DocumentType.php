<?php

namespace Modules\Billing\Enums;

/**
 * The numbered document series a tenant maintains. Each has its own
 * independent counter row per year, so issuing a credit note never
 * advances the invoice sequence — a gap in either is an audit finding
 * (AGENTS.md Integrity).
 */
enum DocumentType: string
{
    case INVOICE = 'invoice';
    case CREDIT_NOTE = 'credit_note';

    /** The config/billing.php key holding this series' prefix and padding. */
    public function configKey(): string
    {
        return match ($this) {
            self::INVOICE => 'billing.invoice_number',
            self::CREDIT_NOTE => 'billing.credit_note_number',
        };
    }
}
