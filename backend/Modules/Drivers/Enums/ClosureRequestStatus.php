<?php

namespace Modules\Drivers\Enums;

/**
 * Where a driver's closure request has got to (ADR-0043).
 *
 * Four states, and `withdrawn` is the one ADR-0032 left out of settlement
 * requests and recorded as more annoying than it looked. Changing your mind
 * about closing your account is not an unusual thing to do.
 */
enum ClosureRequestStatus: string
{
    case PENDING = 'pending';
    case CONFIRMED = 'confirmed';
    case DECLINED = 'declined';
    case WITHDRAWN = 'withdrawn';

    /**
     * Whether this request is still waiting on somebody.
     *
     * The **one-open-per-driver** rule is written in terms of this, so that
     * adding a future state has to answer "does this block a new request?"
     * rather than silently not blocking one.
     */
    public function isOpen(): bool
    {
        return $this === self::PENDING;
    }

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'Waiting for the office',
            self::CONFIRMED => 'Account closed',
            self::DECLINED => 'Not closed',
            self::WITHDRAWN => 'Withdrawn',
        };
    }
}
