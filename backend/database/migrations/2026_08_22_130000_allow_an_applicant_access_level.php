<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A fourth level, for somebody who has applied and been decided about by
 * nobody (ADR-0055 §4, amended).
 *
 * ## Why the constraint has to move
 *
 * `users_access_level_matches_columns` enumerates the levels, so a level it
 * does not name cannot be stored — which is the point of it. Adding
 * `applicant` to the enum without widening the constraint would move the
 * refusal from a readable exception to an SQLSTATE, which is the opposite of
 * what §4's two-sided guard is for.
 *
 * ## What it costs §4, which is nothing
 *
 * §4's rule was never "there are three levels". It is that the level is
 * **declared, never inferred**, because every one of Shanitah's staff — three
 * of them drivers — is a null-client row, and inference would have promoted
 * all six to head office.
 *
 * `applicant` has the same column shape as `kangaru`: no fleet, no client. So
 * the two nulls are now ambiguous between them, and that is **deliberate and
 * safe** — the column says which, and neither can be arrived at by omission.
 * `User::levelFor()` still throws when nothing is declared.
 *
 * ## Why it was needed within a day of shipping
 *
 * Another session tried to create a driver applicant's login at submission
 * time, so a reviewer could refuse one blurry licence without refusing the
 * whole person. An applicant's fleet is chosen by the reviewer at approval, so
 * at submission it is genuinely unknown. The guard refused it on the first
 * run, with the message it was written for, and that session withdrew rather
 * than working around it — which is the system working exactly as intended,
 * and worth recording as such.
 *
 * No backfill: nobody holds this level yet, and nothing may be moved into it
 * by a migration. It is granted by the code that mints an applicant's account,
 * explicitly, one row at a time.
 */
return new class extends Migration
{
    private const CONSTRAINT = 'users_access_level_matches_columns';

    /**
     * Widened in place. `2026_08_22_090200` explains why this invariant is a
     * trigger pair rather than a `CHECK` — MySQL 8.4 refuses a `CHECK` naming
     * a column that carries a foreign key with a referential action, and
     * `users.tenant_id` is `ON DELETE SET NULL`.
     */
    private const TRIGGERS = [
        'users_access_level_bi' => 'INSERT',
        'users_access_level_bu' => 'UPDATE',
    ];

    private const CLAUSES = [
        "(NEW.access_level = 'kangaru'   AND NEW.operator_id IS NULL     AND NEW.tenant_id IS NULL)",
        "(NEW.access_level = 'applicant' AND NEW.operator_id IS NULL     AND NEW.tenant_id IS NULL)",
        "(NEW.access_level = 'fleet'     AND NEW.operator_id IS NOT NULL AND NEW.tenant_id IS NULL)",
        "(NEW.access_level = 'client'    AND NEW.operator_id IS NULL     AND NEW.tenant_id IS NOT NULL)",
    ];

    public function up(): void
    {
        self::rebuild(self::CLAUSES);
    }

    public function down(): void
    {
        // Rolling back while an applicant account exists does not delete it —
        // the narrower rule simply refuses the next write to that row.
        // Reversing a schema that permitted something is not a way to remove
        // the rows created under it. CI rolls back an empty database, where
        // the question does not arise.
        self::rebuild(array_values(array_filter(
            self::CLAUSES,
            fn (string $clause) => ! str_contains($clause, 'applicant'),
        )));
    }

    /**
     * A trigger cannot be altered, only replaced, so both directions drop and
     * recreate the pair. `IF EXISTS` because `down()` may run against a
     * database where `up()` never did.
     *
     * @param  list<string>  $clauses
     */
    private static function rebuild(array $clauses): void
    {
        foreach (self::TRIGGERS as $name => $event) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$name}");
            DB::unprepared(
                "CREATE TRIGGER {$name} BEFORE {$event} ON users FOR EACH ROW BEGIN "
                .'IF NOT ('.implode(' OR ', $clauses).') THEN '
                ."SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '".self::CONSTRAINT."'; "
                .'END IF; END'
            );
        }
    }
};
