<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where each vehicle is *now* (ADR-0019).
     *
     * One row per vehicle, overwritten on every ping — not a log. The
     * history lives in `trip_locations`, which is partitioned by month and
     * expected to reach ~500M rows a year; answering "where is UAA 123B"
     * from it means an index dive into the largest table in the system,
     * repeated for every vehicle, every few seconds, on a live map. At
     * 2,000 vehicles this table is 2,000 hot rows that stay in the buffer
     * pool.
     *
     * `vehicle_id` is the primary key rather than an auto-increment with a
     * unique index on it. The upsert is the entire access pattern, and a
     * surrogate key would add a second index to maintain on every write for
     * a row nobody ever addresses any other way.
     *
     * No foreign keys to `trips`: that table is not partitioned so a key
     * would be legal, but a live position outliving its trip's soft delete
     * is a stale row to prune, not an integrity violation to refuse — and
     * the write path must never fail because of one.
     */
    public function up(): void
    {
        Schema::create('live_positions', function (Blueprint $table) {
            $table->foreignId('vehicle_id')->primary()->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('trip_id');
            $table->unsignedBigInteger('driver_id')->nullable();

            // Same precision as `trip_locations`, and for the same reason:
            // 7 decimal places is ~11mm, which is finer than any consumer
            // GPS and leaves no rounding argument in a billing dispute.
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->decimal('speed_kph', 6, 2)->nullable();
            $table->unsignedSmallInteger('heading_degrees')->nullable();

            // When the *device* recorded it, not when we stored it. The
            // difference is the ingestion lag AGENTS.md wants alerted on,
            // and a map that showed storage time would hide exactly the
            // staleness it exists to reveal.
            $table->dateTime('recorded_at');
            $table->timestamps();

            // The live map's query is "positions for these trips", and the
            // dispatcher's is "everything moving for this client".
            $table->index(['tenant_id', 'recorded_at']);
            $table->index('trip_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('live_positions');
    }
};
