<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where the pickup actually is (ADR-0020 §2).
     *
     * `bookings.origin` is a string somebody typed. That is enough for a
     * human dispatcher, who knows that "Head Office" means Kampala Road,
     * and useless to a matcher: ranking drivers by proximity needs two
     * points, and ADR-0019 only supplied the vehicle's.
     *
     * Nullable, and that is the whole migration strategy. Every booking that
     * already exists has no coordinates and never will; the recommender
     * falls back to ranking on availability and capacity for those rather
     * than refusing to answer. Requiring them would have meant a backfill
     * against a geocoder for historical rows nobody will dispatch again.
     *
     * Destination is deliberately left out. Dispatch cares about who can
     * reach the pickup soonest; the far end matters to pricing and route
     * preview, and neither is this ADR.
     */
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Same 10,7 as `trip_locations` and `live_positions`, so the
            // three can be compared without a cast: ~11mm, finer than any
            // consumer GPS.
            $table->decimal('origin_latitude', 10, 7)->nullable()->after('origin');
            $table->decimal('origin_longitude', 10, 7)->nullable()->after('origin_latitude');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['origin_latitude', 'origin_longitude']);
        });
    }
};
