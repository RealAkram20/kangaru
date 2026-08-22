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
 * MariaDB 10.2+ and MySQL 8.0.16+ both enforce `CHECK`. The three levels are
 * mutually exclusive and each pins both columns, so a `fleet` user with no
 * operator — the exact shape of a silent promotion — cannot be written at all,
 * by any code path, including a raw query or a future seeder. An invariant a
 * reviewer has to remember is an invariant that eventually ships broken.
 */
return new class extends Migration
{
    private const CONSTRAINT = 'users_access_level_matches_columns';

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

        DB::statement('ALTER TABLE users ADD CONSTRAINT '.self::CONSTRAINT.' CHECK ('
            ."(access_level = 'kangaru' AND operator_id IS NULL     AND tenant_id IS NULL)"
            ." OR (access_level = 'fleet'   AND operator_id IS NOT NULL AND tenant_id IS NULL)"
            ." OR (access_level = 'client'  AND operator_id IS NULL     AND tenant_id IS NOT NULL)"
            .')');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT '.self::CONSTRAINT);

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('access_level');
        });
    }
};
