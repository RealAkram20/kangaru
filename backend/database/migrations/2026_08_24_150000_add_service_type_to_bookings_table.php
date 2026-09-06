<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ADR-0064: a booking now names which of the platform's three services
     * it asks for. Everything before this migration was a ride — the walk-in
     * form has offered ride, delivery and self-drive since ADR-0012, and the
     * internal channel is only now catching up — so the default is honest
     * about history as well as convenient for old clients.
     */
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Validated string cast to OrderRequestServiceType on the model —
            // the same enum the walk-in order carries, deliberately, so the
            // two channels cannot grow different vocabularies for one fleet.
            $table->string('service_type')->default('ride')->after('passenger_count');

            // The per-service extras (a parcel's recipient, a rental's hire
            // dates), allow-listed per service by BookingDetails before they
            // are written or read — the OrderDetails lesson, applied on day
            // one rather than after the leak.
            $table->json('details')->nullable()->after('service_type');
        });

        // A self-drive rental has no route: the renter collects the vehicle
        // and drives it themselves. NULL here means "not this service's
        // question", the same reading order_requests gives its own nullable
        // pickup/dropoff pair.
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('origin')->nullable()->change();
            $table->string('destination')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['service_type', 'details']);
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->string('origin')->nullable(false)->change();
            $table->string('destination')->nullable(false)->change();
        });
    }
};
