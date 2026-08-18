<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The two tables that hang off a trip and inherited its tenant (ADR-0024 §1).
 *
 * `trips.tenant_id` became nullable in the migration before this one, and
 * both of these copy it on write:
 *
 * - `TripEvent::record()` writes `'tenant_id' => $trip->tenant_id` on every
 *   single transition. Left NOT NULL, the *first state change on the first
 *   walk-in trip* fails — and it fails inside `TripStateMachine`, which is
 *   the one path every lifecycle move goes through.
 * - `TripLocationController` passes `$trip->tenant_id` to
 *   `RecordTripLocations`, so every GPS ping on a walk-in trip would fail
 *   the same way, in a queued job, where nobody is watching.
 *
 * The `create_trip_events_table` migration says in a comment that "unlike
 * audit_logs.tenant_id, a Trip is always tenant-owned". That was true when
 * it was written and stopped being true with ADR-0024; the comment is
 * corrected here rather than left to mislead the next reader.
 *
 * **This is not a new idea in the schema.** `audit_logs.tenant_id` has
 * always been nullable, and ADR-0007's migration made `report_exports` and
 * `notifications` nullable for the same reason: a row that belongs to the
 * platform rather than to a client. `TenantScope` filters
 * `where tenant_id = <bound>`, which never matches NULL, so a client cannot
 * see these rows — the isolation is unchanged and, if anything, stricter
 * than it was for a row carrying a real tenant.
 *
 * Nothing is backfilled. Every existing row keeps its tenant.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trip_events', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
        });

        Schema::table('trip_events', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable()->change();
        });

        Schema::table('trip_events', function (Blueprint $table) {
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });

        // Raw DDL, because `trip_locations` is partitioned and was created
        // with raw DDL for the reasons its own migration sets out. It has no
        // foreign key to drop first (InnoDB refuses them on a partitioned
        // table), and `tenant_id` is not a partitioning column — the
        // partition is by `recorded_at` — so this is an ordinary column
        // change rather than a reorganisation.
        DB::statement('ALTER TABLE `trip_locations` MODIFY `tenant_id` BIGINT UNSIGNED NULL');
    }

    public function down(): void
    {
        $orphanEvents = DB::table('trip_events')->whereNull('tenant_id')->count();
        $orphanPings = DB::table('trip_locations')->whereNull('tenant_id')->count();

        if ($orphanEvents > 0 || $orphanPings > 0) {
            // Both tables are evidence — `trip_events` is the append-only
            // lifecycle timeline and `trip_locations` is the route a
            // distance was reconciled against. Deleting either to satisfy a
            // rollback would destroy the record of journeys that happened.
            throw new RuntimeException(
                "Cannot roll back: {$orphanEvents} trip event(s) and {$orphanPings} location ping(s) "
                .'belong to customer-owned trips and have no tenant to return to. Deal with them '
                .'explicitly before reversing ADR-0024.'
            );
        }

        DB::statement('ALTER TABLE `trip_locations` MODIFY `tenant_id` BIGINT UNSIGNED NOT NULL');

        Schema::table('trip_events', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
        });

        Schema::table('trip_events', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable(false)->change();
        });

        Schema::table('trip_events', function (Blueprint $table) {
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
    }
};
