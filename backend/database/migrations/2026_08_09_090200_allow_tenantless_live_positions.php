<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The last table that copies a trip's tenant (ADR-0024 §1).
 *
 * `live_positions.tenant_id` is written from `$trip->tenant_id` by
 * `TripRouteRecorder`, so a walk-in ride — which is precisely the kind of
 * trip somebody watches move across a map — could not report its position
 * at all.
 *
 * **This one is safe to null in a way the others had to argue for**, because
 * nothing reads it for isolation. `LivePositionController` resolves
 * visibility by asking which *trips* the caller may see and taking the
 * positions from the vehicles on them, and its own docblock explains why:
 * filtering `live_positions.tenant_id` directly would be a second copy of
 * the trips predicate, and "when the two drifted, the failure would be a
 * client watching another client's vehicle move across a map". That design
 * decision, made for a different reason, is what makes a null here a
 * non-event for ADR-0001.
 *
 * The `(tenant_id, recorded_at)` index is left in place. It serves the
 * per-client sweep, which simply returns nothing for walk-ins — and a walk-in
 * belongs to no client, so there is no sweep it should have appeared in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('live_positions', function (Blueprint $table) {
            // No foreign key to drop: this column never had one. The
            // original migration left it a bare `unsignedBigInteger`,
            // because a live position outliving its trip is a stale row to
            // prune rather than an integrity violation to refuse.
            $table->unsignedBigInteger('tenant_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        // Unlike `trip_events` and `trip_locations`, these rows are a
        // snapshot rather than evidence — the store's own interface calls
        // it "a snapshot, not a log", and `forget()` already exists as a
        // supported operation. Deleting the tenantless ones loses nothing
        // that is not re-reported on the next ping.
        DB::table('live_positions')->whereNull('tenant_id')->delete();

        Schema::table('live_positions', function (Blueprint $table) {
            $table->unsignedBigInteger('tenant_id')->nullable(false)->change();
        });
    }
};