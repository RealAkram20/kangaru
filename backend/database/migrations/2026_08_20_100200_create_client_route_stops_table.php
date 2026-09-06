<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0045 §1: a place's position in a route.
 *
 * Deliberately thin. Everything about *where* the stop is lives on
 * `client_places` and is read through the relation — a name and a pair of
 * coordinates copied down here would be two places to correct when an
 * officer moves a pin, and they would disagree within a month.
 *
 * That copying does happen exactly once, later and in the other direction:
 * `trip_stops` snapshots the place onto the journey, because evidence must
 * not follow the plan. Here, the plan is allowed to move.
 *
 * ## `tenant_id` on a child table
 *
 * ADR-0001 says every tenant-owned table carries one, and `trip_events`
 * already sets the precedent for a row whose parent is scoped anyway. The
 * redundancy is the point: the isolation suite reaches this table directly,
 * and a join that must be correct for the scoping to hold is a join someone
 * will one day write differently.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_route_stops', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('client_route_id')->constrained()->cascadeOnDelete();

            // restrictOnDelete, not cascade: a place cannot be deleted out
            // from under the routes that visit it. Retiring is `is_active`,
            // and a route referencing a retired place still draws — it just
            // warns. Cascading here would silently shorten a bank's cash
            // circuit because somebody tidied the register.
            $table->foreignId('client_place_id')->constrained()->restrictOnDelete();

            $table->unsignedSmallInteger('sequence');

            // What the client expects servicing this site to take. An
            // expectation, never a measurement — the real dwell is
            // `trip_stops.arrived_at`/`departed_at`, and no screen may show
            // this number where that one belongs.
            $table->unsignedSmallInteger('expected_dwell_minutes')->nullable();

            // Per-stop instructions for this route specifically, as opposed
            // to the standing ones on the place itself.
            $table->text('driver_notes')->nullable();

            $table->timestamps();

            // An ordered list is only ordered if the database says so.
            // `ClientRouteService` rewrites the whole set inside one
            // transaction rather than shuffling rows past each other,
            // which is what keeps this key satisfiable mid-reorder.
            $table->unique(['client_route_id', 'sequence']);
            $table->index(['tenant_id', 'client_place_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_route_stops');
    }
};
