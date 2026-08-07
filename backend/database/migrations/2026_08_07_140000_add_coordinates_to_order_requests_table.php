<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a walk-in order's pickup and drop-off actually are (ADR-0020 §2,
     * completing it).
     *
     * The public order form has geocoded from its first day —
     * `frontend/src/pages/public/places.ts` returns `lngLat` for every
     * suggestion, and the form already holds it to centre the map. It was
     * simply never sent, so the platform threw away the one thing that makes
     * proximity dispatch possible and then had nothing to rank by.
     *
     * Both ends here, unlike `bookings` which took origin only. A booking is
     * dispatched from its pickup; an order request is also the record a
     * *quote* will eventually be computed from, and distance needs two
     * points.
     *
     * Nullable throughout. An order taken over the phone by a dispatcher has
     * no coordinates and never will, and a geocoder outage must degrade to
     * plain text rather than refuse the order — `places.ts` is explicit that
     * "everything fails soft", and this column follows it.
     */
    public function up(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            // 10,7 matches `bookings`, `trip_locations` and `live_positions`
            // so the four can be compared without a cast.
            $table->decimal('pickup_latitude', 10, 7)->nullable()->after('pickup_location');
            $table->decimal('pickup_longitude', 10, 7)->nullable()->after('pickup_latitude');
            $table->decimal('dropoff_latitude', 10, 7)->nullable()->after('dropoff_location');
            $table->decimal('dropoff_longitude', 10, 7)->nullable()->after('dropoff_latitude');
        });
    }

    public function down(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            $table->dropColumn([
                'pickup_latitude', 'pickup_longitude',
                'dropoff_latitude', 'dropoff_longitude',
            ]);
        });
    }
};
