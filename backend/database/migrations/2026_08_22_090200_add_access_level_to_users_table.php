<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which level an account belongs to, said out loud (ADR-0055 §4).
 *
 * ## The hazard this column exists to remove
 *
 * Under ADR-0055, "no client and no fleet" describes **Kangaru** — the most
 * privileged level on the platform. Every one of Shanitah's staff is a
 * `tenant_id IS NULL` row today, so a migration that inferred the level from
 * the two columns would promote them all.
 *
 * Counted on the development database before this was written, and it is worse
 * than the plan predicted:
 *
 *     users total                     10
 *     users WHERE tenant_id IS NULL    6
 *       #3  Platform Super Admin   super_admin
 *       #4  Dispatch Desk          dispatcher
 *       #5  Finance Officer        finance
 *       #8  Demo Driver            driver
 *       #9  Recruited Rider        driver
 *       #10 Demo Driver (free)     driver
 *
 * **Three of the six are drivers.** A driver belongs to no corporate client, so
 * a driver is a null-client user — which the plan did not anticipate. Inferring
 * the level would have handed `driver@kangaruride.test` read access to every
 * fleet on the platform, and nothing would have failed: the account would
 * simply have started working better than it should.
 *
 * ## Nobody becomes Kangaru here
 *
 * Every null-client user becomes `fleet` on operator 1, **including the Super
 * Admin.** That is deliberate and it is not what the plan's first draft said.
 *
 * F0's binding constraint is zero behaviour change. A `kangaru` account sees
 * Kangaru's own rows and nothing else, so promoting the Super Admin here would
 * blank the console for the one account that runs everything and turn the
 * suite red on its most-used fixture. Today's "Platform Super Admin" is
 * Shanitah's top account; Kangaru's own staff are a later package's business,
 * and they arrive with something to do (ADR-0056) rather than as a migration
 * side effect.
 *
 * So `kangaru` exists in the enum and in the constraint with **no account
 * holding it**. That is the safe direction for this to default in: the level
 * has to be granted by a person, never inherited by a backfill.
 *
 * ## The invariant is in the database
 *
 * The three levels are mutually exclusive and each pins both columns, so a
 * `fleet` user with no operator — the exact shape of a silent promotion —
 * cannot be written at all, by any code path, including a raw query or a
 * future seeder. An invariant a reviewer has to remember is an invariant that
 * eventually ships broken.
 *
 * ### Why a trigger and not a `CHECK`
 *
 * This shipped as a `CHECK` constraint and passed on MariaDB 10.4. **MySQL 8.4
 * refuses it**, and CI is the only place that was ever going to say so:
 *
 *     SQLSTATE[HY000]: General error: 3823 Column 'tenant_id' cannot be used
 *     in a check constraint 'users_access_level_matches_columns': needed in a
 *     foreign key constraint 'users_tenant_id_foreign' referential action.
 *
 * MySQL 8 will not let a `CHECK` name a column that carries a foreign key with
 * a referential action, and `users.tenant_id` is `ON DELETE SET NULL` — set
 * deliberately in `2026_07_27_174305`, whose comment says why: *"Deactivated
 * tenant's users aren't destroyed by cascade."* MariaDB permits the
 * combination; MySQL does not.
 *
 * Three ways out, and only one of them keeps what §4 paid for:
 *
 * 1. **Drop `nullOnDelete()`.** Trades a documented, deliberate behaviour for
 *    a syntax convenience. Deleting a client would start destroying or
 *    blocking its people.
 * 2. **Drop the constraint and trust the enum.** Loses exactly the property
 *    ADR-0055 §4 is explicit about paying for — the copy that catches raw
 *    queries and future seeders that never load the model.
 * 3. **A trigger pair.** The rule stays in the database, enforced on every
 *    write by any client, and it works identically on both engines.
 *
 * So: `BEFORE INSERT` and `BEFORE UPDATE` triggers that `SIGNAL SQLSTATE
 * '45000'`. **The message text is the old constraint's name on purpose** —
 * `AccessLevelInvariantTest` asserts on that string, and the assertion should
 * keep meaning the same thing after the mechanism changed underneath it.
 *
 * Unconditional, not branched on the driver. One code path and one behaviour
 * on both engines is worth more than the `CHECK` was, and an engine-specific
 * schema is a difference that only ever surfaces in production.
 */
return new class extends Migration
{
    /**
     * The message a refused write carries. It was a constraint name before it
     * was a trigger's `MESSAGE_TEXT`, and it keeps the name so the assertion
     * in `AccessLevelInvariantTest` keeps meaning the same thing.
     */
    private const CONSTRAINT = 'users_access_level_matches_columns';

    /** Both write paths. A rule enforced on insert only is not enforced. */
    private const TRIGGERS = [
        'users_access_level_bi' => 'INSERT',
        'users_access_level_bu' => 'UPDATE',
    ];

    private const CLAUSES = [
        "(NEW.access_level = 'kangaru' AND NEW.operator_id IS NULL     AND NEW.tenant_id IS NULL)",
        "(NEW.access_level = 'fleet'   AND NEW.operator_id IS NOT NULL AND NEW.tenant_id IS NULL)",
        "(NEW.access_level = 'client'  AND NEW.operator_id IS NULL     AND NEW.tenant_id IS NOT NULL)",
    ];

    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('access_level', 16)->nullable()->after('operator_id');
        });

        // A client's people keep their client and gain no fleet.
        DB::table('users')->whereNotNull('tenant_id')->update([
            'access_level' => 'client',
            'operator_id' => null,
        ]);

        // Everyone else is Shanitah's — staff and drivers alike. See the
        // docblock for why none of them becomes Kangaru.
        DB::table('users')->whereNull('tenant_id')->update([
            'access_level' => 'fleet',
            'operator_id' => 1,
        ]);

        Schema::table('users', function (Blueprint $table) {
            $table->string('access_level', 16)->nullable(false)->change();
        });

        foreach (self::TRIGGERS as $name => $event) {
            DB::unprepared(
                "CREATE TRIGGER {$name} BEFORE {$event} ON users FOR EACH ROW BEGIN "
                .'IF NOT ('.implode(' OR ', self::CLAUSES).') THEN '
                ."SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '".self::CONSTRAINT."'; "
                .'END IF; END'
            );
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::TRIGGERS) as $name) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$name}");
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('access_level');
        });
    }
};
