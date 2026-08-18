<?php

namespace Modules\Drivers\Enums;

/**
 * What became of an application (ADR-0027).
 *
 * Three cases, and unlike `UserStatus` all three are consulted: pending is
 * what the queue filters on, approved and rejected are both terminal and
 * mean different things to the person who applied.
 */
enum DriverApplicationStatus: string
{
    case PENDING = 'pending';
    case APPROVED = 'approved';
    case REJECTED = 'rejected';

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'Awaiting review',
            self::APPROVED => 'Approved',
            self::REJECTED => 'Rejected',
        };
    }

    /**
     * Whether this application is still open to a decision.
     *
     * Asked before approving or rejecting, so that a second reviewer acting
     * on a stale list is refused rather than silently overwriting the first
     * one's decision — and, more to the point, rather than minting a second
     * account for somebody who already has one.
     */
    public function isOpen(): bool
    {
        return $this === self::PENDING;
    }
}
