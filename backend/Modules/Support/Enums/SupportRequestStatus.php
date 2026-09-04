<?php

namespace Modules\Support\Enums;

/**
 * Where a driver's report has got to (ADR-0044 §2).
 *
 * **Two states, and the missing third is the decision.** There is no "closed"
 * without an answer, because an office that can close a report in silence
 * reproduces the failure this feature was built to end: the driver who reports
 * something serious and hears nothing.
 *
 * That makes the loop closed by construction rather than by discipline — the
 * only way out of `OPEN` is through an answer somebody wrote.
 */
enum SupportRequestStatus: string
{
    case OPEN = 'open';
    case ANSWERED = 'answered';

    /** Whether the office still owes this driver a reply. */
    public function isOpen(): bool
    {
        return $this === self::OPEN;
    }

    /**
     * The driver's word for it, not the office's.
     *
     * "Waiting for the office" rather than "Open", for the reason
     * `SettlementRequestStatus` says the same thing: a status is read by
     * somebody who wants to know whether anyone is dealing with it, and
     * "Open" answers a database question instead.
     */
    public function label(): string
    {
        return match ($this) {
            self::OPEN => 'Waiting for the office',
            self::ANSWERED => 'Answered',
        };
    }
}
