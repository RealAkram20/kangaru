<?php

namespace App\Enums;

/**
 * Which of the three levels an account belongs to (ADR-0055 §4).
 *
 * This is stated on the row, never worked out from it. The distinction is the
 * whole point of the column: under ADR-0055 "no client and no fleet" describes
 * **Kangaru**, and every one of Shanitah's staff — including its drivers — is a
 * null-client row today. A level inferred from two nulls would have promoted
 * six accounts to head office silently, with nothing failing.
 *
 * So `KANGARU` is only ever reached by somebody declaring it. It cannot be
 * arrived at by omission, by a backfill, or by a `User::create()` that forgot
 * an argument.
 *
 * `permits()` is the PHP half of a rule the database also holds: the migration
 * `2026_08_22_090200_add_access_level_to_users_table` writes the same three
 * clauses as a `CHECK` constraint. Two copies is a real cost, and it is paid
 * deliberately — the constraint catches raw queries and future seeders that
 * never touch this class, and this method gives a caller a readable failure
 * instead of an SQLSTATE. `AccessLevelInvariantTest` asserts they agree.
 */
enum AccessLevel: string
{
    /** Head office. Owns no fleet and reads across none (ADR-0055 §2). */
    case KANGARU = 'kangaru';

    /** A fleet company's own people — staff and drivers alike. */
    case FLEET = 'fleet';

    /** A corporate client's own people. */
    case CLIENT = 'client';

    /**
     * Somebody applying to drive, before anybody has decided anything
     * (ADR-0027, ADR-0048 §4).
     *
     * Added after this enum shipped, because a driver applicant is genuinely
     * none of the three above: their fleet is chosen by a reviewer at
     * approval, so at submission it is unknown rather than absent. Without
     * this case, "no fleet and no client" filed **every stranger who filled in
     * the form as head office**, and the §4 guard refused it — correctly, and
     * within an hour of the feature being attempted.
     *
     * A fourth *declared* level costs §4 nothing. Its rule was never "three
     * levels"; it is that the level is **declared, never inferred**. Two nulls
     * still cannot become Kangaru by omission, and they cannot become an
     * applicant by omission either.
     *
     * **It grants nothing.** An applicant's reach is keyed entirely off their
     * own id — their own application and no more — which is not a scoping
     * question at all. It is the shape `Customer` already has (ADR-0013), and
     * the reason a walk-in is not a `users` row. So `AccessContext` leaves an
     * applicant unbound, which is the fail-closed state, and every scoped read
     * returns nothing.
     */
    case APPLICANT = 'applicant';

    /**
     * Whether this level is consistent with the two ownership columns.
     *
     * Each level pins **both** columns, which is what makes them mutually
     * exclusive rather than merely different. A `FLEET` row with no
     * `operator_id` is the exact shape of a silent promotion, so it is not
     * permitted to exist rather than merely discouraged.
     */
    public function permits(?int $operatorId, ?int $tenantId): bool
    {
        return match ($this) {
            self::KANGARU => $operatorId === null && $tenantId === null,
            self::FLEET => $operatorId !== null && $tenantId === null,
            self::CLIENT => $operatorId === null && $tenantId !== null,
            // Same shape as KANGARU, and that ambiguity is deliberate: the
            // column says which, never the two nulls.
            self::APPLICANT => $operatorId === null && $tenantId === null,
        };
    }

    /**
     * What a person is shown. Never "tenant" — ADR-0055 §1 makes that word
     * mean the opposite of what the owner means by it, so it stays out of
     * anything readable.
     */
    public function label(): string
    {
        return match ($this) {
            self::KANGARU => 'Kangaru',
            self::FLEET => 'Fleet',
            self::CLIENT => 'Client',
            self::APPLICANT => 'Applicant',
        };
    }
}
