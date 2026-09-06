<?php

namespace Modules\Drivers\Enums;

/**
 * What the office made of a document (ADR-0033 §3).
 *
 * **Three stored states. `expired` is deliberately not one of them** — it is
 * derived from `expires_at` at read time by
 * `DriverDocument::complianceState()`. A stored expiry status needs a nightly
 * job and is wrong for up to a day every time it runs; a comparison against
 * today is right at every instant and costs nothing.
 *
 * **Nothing reaches `verified` without a person.** There is no OCR, no
 * third-party identity check, and no "verified because the expiry is in the
 * future" — a machine that marks a licence verified is the original problem
 * wearing a better hat (ADR-0033 §4).
 */
enum DriverDocumentStatus: string
{
    case PENDING = 'pending';
    case VERIFIED = 'verified';
    case REJECTED = 'rejected';

    /** Whether the office still has to look at it. */
    public function isOpen(): bool
    {
        return $this === self::PENDING;
    }

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'Waiting for the office',
            self::VERIFIED => 'Verified',
            self::REJECTED => 'Rejected',
        };
    }
}
