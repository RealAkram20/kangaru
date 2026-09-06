<?php

namespace Modules\Drivers\Enums;

/**
 * Where a settlement request has got to (ADR-0032 §3).
 *
 * Three states and no path back. A confirmed request is never un-confirmed —
 * a mistake is corrected the way ADR-0029 §1 corrects everything, with a new
 * `adjustment` entry that reverses the old one, so the record of what was
 * believed at the time survives.
 */
enum SettlementRequestStatus: string
{
    case PENDING = 'pending';
    case CONFIRMED = 'confirmed';
    case DECLINED = 'declined';

    /** Whether the office can still act on it. */
    public function isOpen(): bool
    {
        return $this === self::PENDING;
    }

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'Waiting for the office',
            self::CONFIRMED => 'Confirmed',
            self::DECLINED => 'Declined',
        };
    }
}
