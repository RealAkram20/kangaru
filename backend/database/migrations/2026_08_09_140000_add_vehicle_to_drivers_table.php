<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The vehicle a driver actually drives.
 *
 * ## Why this belongs on the driver
 *
 * Because in this market it is a fact about the person, not about the shift.
 * Most drivers here own their vehicle — overwhelmingly so for boda riders,
 * where the rider and the motorcycle are not separable in any practical
 * sense. Modelling it as something a dispatcher allocates each morning
 * describes a corporate fleet, and this platform is now also a hailing
 * operator.
 *
 * Before this, the only place a driver's vehicle existed was
 * `driver_presence.vehicle_id`, set when they went on duty. That made a
 * permanent fact into a per-shift one, and the consequence showed up
 * immediately: the app sends whatever the server already knew, which on a
 * first sign-on is nothing, so going on duty *cleared* the vehicle and left
 * the driver ranked by the matcher but permanently unofferable.
 *
 * ## Nullable, and deliberately not exclusive
 *
 * Nullable because a corporate driver takes whatever the depot gives them
 * that day, and that is still a real driver — `driver_presence.vehicle_id`
 * remains the per-shift answer and still wins when it is set.
 *
 * No unique index, unlike `drivers.user_id`. Two drivers may share a company
 * car on opposite shifts, and `TripAssignmentGuard` is what stops them both
 * being on it at once — a database constraint here would refuse a legitimate
 * arrangement to restate a rule that is already enforced where it belongs.
 *
 * `nullOnDelete`, not cascade: a vehicle leaving the fleet must not take the
 * driver's record with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->foreignId('vehicle_id')
                ->nullable()
                ->after('user_id')
                ->constrained()
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropForeign(['vehicle_id']);
            $table->dropColumn('vehicle_id');
        });
    }
};
