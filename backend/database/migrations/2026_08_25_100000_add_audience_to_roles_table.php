<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Who each role was composed for (ADR-0004, `App\Enums\RoleAudience`).
 *
 * ## The ten are named, not defaulted
 *
 * Every existing role is assigned here by slug, in the map below. A default
 * would have been one line and it is refused for the reason ADR-0055 §4
 * refuses an inferred `access_level`: the wrong answer arrives silently and
 * looks healthy. A role defaulted to `fleet` would appear in a fleet owner's
 * picker as though head office had put it there.
 *
 * The map is also the one place the ten are written down against a level, so
 * a reviewer can check it against `RoleSeeder` by eye.
 *
 * ## Why `driver` is a fleet role
 *
 * A driver belongs to a fleet, and their account is a `fleet`-level row —
 * the `add_access_level` migration found this the hard way, counting three
 * drivers among six null-client users and noting that inferring the level
 * would have handed a driver read access to every fleet on the platform. The
 * audience follows the level, so `driver` is `fleet` and not an audience of
 * its own.
 *
 * ## Nullable, then backfilled, then not nullable
 *
 * The same three steps `add_access_level_to_users_table` used, and for the
 * same reason: the column cannot be `NOT NULL` on creation because the rows
 * that must satisfy it are already there.
 */
return new class extends Migration
{
    /**
     * Slug to audience. Every role seeded by `RoleSeeder` appears here.
     *
     * @var array<string, string>
     */
    private const AUDIENCES = [
        // Head office. `super_admin` is the only role written for Kangaru's
        // own staff — and note that today's holders of it are mostly
        // *fleet*-level accounts, which is exactly the point ADR-0065 makes:
        // what bounds a Super Admin is the level, not the slug.
        'super_admin' => 'kangaru',

        // A fleet company's own office and yard.
        'operations_manager' => 'fleet',
        'dispatcher' => 'fleet',
        'finance' => 'fleet',
        'fleet_owner' => 'fleet',
        'branch_manager' => 'fleet',
        'depot_manager' => 'fleet',
        'driver' => 'fleet',

        // A corporate client's own people.
        'corporate_admin' => 'client',
        'corporate_employee' => 'client',
    ];

    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->string('audience', 16)->nullable()->after('is_system');
        });

        foreach (self::AUDIENCES as $slug => $audience) {
            DB::table('roles')->where('slug', $slug)->update(['audience' => $audience]);
        }

        /*
         * Any custom role authored before this migration. There are none in
         * production — the catalogue is the ten seeded rows — but a
         * development database may hold one, and the column cannot be made
         * NOT NULL with a null in it.
         *
         * `fleet` is the safe landing for a stray: it is the level almost
         * every existing account holds, so a custom role written for somebody
         * real keeps working. It is a fallback for rows this map does not
         * know, never a default for the ten it does.
         */
        DB::table('roles')->whereNull('audience')->update(['audience' => 'fleet']);

        Schema::table('roles', function (Blueprint $table) {
            $table->string('audience', 16)->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->dropColumn('audience');
        });
    }
};
