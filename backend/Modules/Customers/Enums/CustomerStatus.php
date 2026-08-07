<?php

namespace Modules\Customers\Enums;

/**
 * Whether a customer account may still be used (ADR-0018 §3).
 *
 * Two states, not three. "Deleted" is deliberately absent: an account's
 * order history is the evidence behind any dispute about it, and removing
 * the account to stop somebody using it would destroy the record of why
 * they were stopped. Suspension keeps both.
 */
enum CustomerStatus: string
{
    case ACTIVE = 'active';
    case SUSPENDED = 'suspended';

    public function canSignIn(): bool
    {
        return $this === self::ACTIVE;
    }

    public function label(): string
    {
        return match ($this) {
            self::ACTIVE => 'Active',
            self::SUSPENDED => 'Suspended',
        };
    }
}
