<?php

namespace Modules\Billing\Enums;

/**
 * Whether a rate card may still be selected for new invoices.
 *
 * Archiving a card never affects invoices already issued against it: those
 * reference a specific `rate_card_versions` row, which is immutable once
 * used regardless of the card's status.
 */
enum RateCardStatus: string
{
    case ACTIVE = 'active';
    case ARCHIVED = 'archived';
}
