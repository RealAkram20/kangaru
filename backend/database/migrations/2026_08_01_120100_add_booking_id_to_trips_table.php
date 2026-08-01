<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Nullable on purpose: a dispatcher may still raise an ad-hoc
            // trip with no prior booking (a phone call to the desk), which
            // POST /api/v1/trips continues to serve. Unique because Phase 1
            // fulfils a booking with exactly one trip — a rejected driver is
            // modelled by reassigning the same Trip row, not by issuing a
            // second one (see Modules/Trips/Enums/TripStatus.php).
            $table->foreignId('booking_id')->nullable()->after('tenant_id')
                ->constrained('bookings')->restrictOnDelete();
            $table->unique('booking_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Order matters on MySQL: the unique index backs the foreign
            // key, so dropping it first fails with errno 1553.
            $table->dropForeign(['booking_id']);
            $table->dropUnique(['booking_id']);
            $table->dropColumn('booking_id');
        });
    }
};
