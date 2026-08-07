<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Geofences — the areas the platform reasons about (ADR-0021).
     *
     * PROJECT.md's Geofencing Engine: "Town zones, upcountry zones,
     * client-specific zones, branch boundaries, depot boundaries, service
     * areas. Automatically determines pricing zone, driver eligibility, and
     * vehicle eligibility."
     *
     * ## Why the boundary is JSON and not a POLYGON column
     *
     * MariaDB 10.4 *does* support spatial types and `ST_Contains` — that was
     * checked rather than assumed. It is not used, for three reasons:
     *
     * 1. The frontend needs the ring as data anyway, to draw the zone on a
     *    map. A geometry column means every read is an `ST_AsGeoJSON` and
     *    every write a `ST_GeomFromText`, for a shape that is already JSON
     *    at both ends.
     * 2. Point-in-polygon in PHP is exactly testable — edges, vertices and
     *    concave shapes can be asserted against known answers. `ST_Contains`
     *    correctness depends on SRID and winding-order semantics that are
     *    harder to pin down and vary between engines.
     * 3. At PROJECT.md's scale — 50 tenants, a few zones each — resolution
     *    loads a cached handful of rings and tests them in microseconds.
     *
     * The upgrade path is deliberate and written down: when zone counts
     * reach the thousands, add a `POLYGON` column beside this one plus a
     * SPATIAL index, backfill, and move the filter into SQL. The JSON stays
     * as the renderable source of truth.
     *
     * ## The ring format
     *
     * `[{"lat": 0.3476, "lng": 32.5825}, …]` — named keys, not GeoJSON's
     * positional `[lng, lat]`. That ordering is the single most common
     * coordinate bug there is, and ADR-0020 records this codebase hitting a
     * lat/lng swap that no range check could catch. Named keys make the
     * mistake impossible to write silently.
     */
    public function up(): void
    {
        Schema::create('zones', function (Blueprint $table) {
            $table->id();

            // Null means the zone is the platform's — a town, an upcountry
            // band, the service area. A tenant id means it belongs to one
            // client, which is what PROJECT.md calls a "client-specific
            // zone". Nullable rather than a separate table because the
            // question dispatch asks is identical for both.
            $table->foreignId('tenant_id')->nullable()->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->string('kind', 24);
            $table->json('boundary');

            // Zones overlap by design: a client's own zone sits inside a
            // town which sits inside the service area. Lower wins, so a
            // client zone (10) beats a town (50) beats the service area
            // (90) without anybody having to order the query.
            $table->unsignedSmallInteger('priority')->default(50);

            $table->boolean('active')->default(true);
            $table->string('notes', 255)->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The resolver's query is "active zones, this tenant's or the
            // platform's", and it runs per booking.
            $table->index(['active', 'kind']);
            $table->index(['tenant_id', 'active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('zones');
    }
};
