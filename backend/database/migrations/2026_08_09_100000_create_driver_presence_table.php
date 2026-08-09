<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who is on duty, in which vehicle, and where (ADR-0024 §2).
 *
 * ## Why not `live_positions`
 *
 * That table answers "where is this vehicle, on this trip", is keyed by
 * vehicle, and is written by the GPS pipeline from Trip Started onward. This
 * one answers "is this driver waiting for work, and how far away are they",
 * is keyed by driver, and is written while they are doing nothing at all.
 *
 * Overloading one table with both would put three lifetimes in one row and
 * would quietly make the live map's <15 s freshness contract (ADR-0019) into
 * the dispatch radius' contract too. They are tuned against different
 * things: one is a map a human watches, the other is a battery budget.
 *
 * ## One row per driver, overwritten
 *
 * A snapshot, not a log — the same shape as `live_positions`, and for the
 * same reason. Nobody asks "where was this driver at 11:04"; the history
 * that matters is `trip_locations`, which is evidence and is partitioned and
 * retained accordingly. Keeping a presence history would be a second
 * 500M-row table answering a question nobody has.
 *
 * ## Duty is stored, not inferred
 *
 * `on_duty` is set by an explicit act at `PUT /me/duty`. A driver who leaves
 * the app running in their pocket at home is not available for work, and a
 * system that decides otherwise sends offers into a void and then reports
 * its own matcher as slow.
 *
 * Presence is **not** availability. `AvailabilityService` still answers
 * rosters, leave, status and conflicting trips, and it answers first: a
 * driver on approved leave who opens the app and goes on duty is refused by
 * the same code that refuses a dispatcher trying to assign them. This
 * narrows a set that availability has already decided.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_presence', function (Blueprint $table) {
            // The driver *is* the key. One row each, overwritten in place,
            // so there is no "which is the current one" question to get
            // wrong and no growth to prune.
            $table->foreignId('driver_id')->primary()->constrained()->cascadeOnDelete();

            $table->boolean('on_duty')->default(false);

            // Which vehicle they are on shift with. Nullable, because a
            // driver can be on duty before they have been handed keys —
            // and `DispatchRecommender` needs to know it to rank the pair,
            // so a null here means "rank them without a vehicle of their
            // own", not "reject them".
            //
            // nullOnDelete, not cascade: a vehicle leaving the fleet must
            // not silently take a driver's whole presence row with it and
            // knock them out of the pool mid-shift.
            $table->foreignId('vehicle_id')->nullable()->constrained()->nullOnDelete();

            // Same 10,7 as `trip_locations`, `live_positions`, `bookings`
            // and `order_requests`, so the five compare without a cast.
            //
            // Nullable as a pair: a driver can be on duty with location
            // permission refused, and that is a driver dispatch can still
            // offer work to — just not one it can rank by distance.
            // ADR-0020's rule holds here: where an input is missing the
            // system says so rather than substituting a guess.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('accuracy_metres', 7, 2)->nullable();

            // The device's clock, not the server's — the same choice
            // `live_positions.recorded_at` makes, and for the same reason:
            // storage time would hide exactly the staleness this column
            // exists to reveal. `presence_ttl_seconds` is measured against
            // this.
            $table->dateTime('recorded_at')->nullable();

            $table->timestamps();

            // The dispatch read: everyone currently on duty. Leading with
            // `on_duty` because that is the equality, with `recorded_at`
            // following for the staleness cut.
            $table->index(['on_duty', 'recorded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_presence');
    }
};