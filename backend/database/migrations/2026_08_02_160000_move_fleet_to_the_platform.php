<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The fleet stops belonging to clients (ADR-0005).
     *
     * Shanitah operates every vehicle and driver; a corporate client owns
     * neither. `vehicles.tenant_id` and `drivers.tenant_id` gave each client
     * a private fleet, which is a misreading of "multi-tenant" — the seed
     * had Centenary Bank with three vehicles and Acme NGO with a different
     * three, and no Shanitah fleet anywhere.
     *
     * ## Order matters, and not the order you would guess
     *
     * The **foreign key goes first**, before the composite unique it sits
     * on. `tenant_id`'s FK uses `vehicles_tenant_id_registration_number_unique`
     * as its supporting index, so dropping the index first fails with
     * "Cannot drop index ... needed in a foreign key constraint" (MariaDB
     * 1553; MySQL 8 refuses likewise). Observed, not predicted — this
     * migration failed on its first run in exactly that way.
     *
     * So: drop the FK, then the index, then the column, then add the global
     * unique the values always deserved. CI runs `down()` too, and it
     * reverses the same sequence.
     *
     * ## This is destructive and irreversible in one respect
     *
     * `down()` restores the columns and the constraints, but it cannot know
     * which client each vehicle belonged to — that fact is being deleted
     * because it was never true. It backfills every row to the lowest
     * tenant id so the schema is valid and the app boots; it does not
     * pretend to restore data. AGENTS.md allows an irreversible data
     * migration with a note in the PR, and this is that note.
     */
    public function up(): void
    {
        // Collapsing two private fleets into one pool can collide: nothing
        // stopped two tenants registering UAA 111A, because the uniqueness
        // was per tenant. A plate is unique in Uganda under any reading, so
        // this is a real duplicate rather than a migration artefact — it is
        // reported rather than silently renamed.
        $this->guardAgainstDuplicates('vehicles', 'registration_number');
        $this->guardAgainstDuplicates('drivers', 'license_number');

        Schema::table('vehicles', function (Blueprint $table) {
            // FK before the index it depends on — see the class docblock.
            $table->dropForeign(['tenant_id']);
            $table->dropUnique(['tenant_id', 'registration_number']);
            $table->dropColumn('tenant_id');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->unique('registration_number');
        });

        Schema::table('drivers', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
            $table->dropUnique(['tenant_id', 'license_number']);
            $table->dropColumn('tenant_id');
        });

        Schema::table('drivers', function (Blueprint $table) {
            $table->unique('license_number');
        });
    }

    public function down(): void
    {
        // Backfilled to the lowest tenant so the NOT NULL foreign key can
        // be added at all. Which client a vehicle "belonged" to is not
        // recoverable — see the class docblock.
        $fallback = DB::table('tenants')->min('id');

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropUnique(['registration_number']);
        });

        Schema::table('vehicles', function (Blueprint $table) use ($fallback) {
            $table->foreignId('tenant_id')->default($fallback)->constrained()->cascadeOnDelete();
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->unique(['tenant_id', 'registration_number']);
        });

        Schema::table('drivers', function (Blueprint $table) {
            $table->dropUnique(['license_number']);
        });

        Schema::table('drivers', function (Blueprint $table) use ($fallback) {
            $table->foreignId('tenant_id')->default($fallback)->constrained()->cascadeOnDelete();
        });

        Schema::table('drivers', function (Blueprint $table) {
            $table->unique(['tenant_id', 'license_number']);
        });
    }

    /**
     * Refuses to run rather than losing a row to a collision.
     */
    private function guardAgainstDuplicates(string $table, string $column): void
    {
        $duplicates = DB::table($table)
            ->select($column)
            ->groupBy($column)
            ->havingRaw('COUNT(*) > 1')
            ->pluck($column);

        if ($duplicates->isNotEmpty()) {
            throw new RuntimeException(
                "Cannot move {$table} to the platform: {$column} is duplicated across tenants (".
                $duplicates->implode(', ').'). '.
                'These were legal while uniqueness was per tenant and are not once the fleet is shared. '.
                'Resolve them before migrating.'
            );
        }
    }
};
