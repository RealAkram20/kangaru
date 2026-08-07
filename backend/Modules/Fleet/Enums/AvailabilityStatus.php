<?php

namespace Modules\Fleet\Enums;

/**
 * Whether a period off the road has been agreed (ADR-0017 §6).
 *
 * ## Why a block has a status at all
 *
 * The Driver's Application (Phase 2, PROJECT.md) is where a driver asks for
 * leave, and where the fleet office answers. That makes the same row two
 * different things depending on who wrote it: an office recording that a van
 * is in the workshop is stating a fact, while a driver asking for Friday off
 * is making a request that somebody has to answer.
 *
 * Modelling only the first and bolting a "leave request" table on later
 * would give the platform two tables that both mean "not available",
 * consulted by one dispatcher — and the day they disagree, a driver is
 * dispatched onto a shift they were told they had off.
 *
 * So there is one table, and a status. Only `APPROVED` withholds a driver
 * or vehicle from dispatch: a request nobody has answered is not yet time
 * off, and treating it as one would let anybody remove themselves from the
 * roster by asking.
 */
enum AvailabilityStatus: string
{
    /** Asked for, not yet answered. Does not affect dispatch. */
    case REQUESTED = 'requested';

    /** Agreed. This is the only status that takes a resource off the road. */
    case APPROVED = 'approved';

    /** Answered no. Kept rather than deleted — see below. */
    case DECLINED = 'declined';

    /**
     * Whether dispatch should treat this block as binding.
     */
    public function withholdsFromDispatch(): bool
    {
        return $this === self::APPROVED;
    }

    /**
     * A declined request is kept, not deleted, and that is deliberate.
     *
     * "I asked for that Friday and was refused" is exactly the fact a driver
     * and a depot manager end up disagreeing about, and a row that deletes
     * itself leaves the disagreement with no record. It also keeps the
     * audit trail honest about a decision somebody made.
     *
     * @return array<int, self>
     */
    public function answerable(): array
    {
        return $this === self::REQUESTED ? [self::APPROVED, self::DECLINED] : [];
    }
}
