<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0051. The kind of vehicle a client asked for.
 *
 * **Nullable, and it stays nullable.** Every booking that predates this has
 * none, and a client with no preference is the ordinary case — the platform
 * has always chosen the vehicle. Null means "no preference stated", which is
 * a different thing from a preference the dispatcher ignored, and the two
 * must stay distinguishable because a bank auditing a trip is entitled to
 * know which it was.
 *
 * A plain string with no foreign key, matching `vehicles.category` and
 * `rate_card_rates.vehicle_category` for ADR-0050 §1's reason: a booking is
 * a record of what was asked for on a day, and it must keep reading
 * correctly after the office renames or retires a category.
 *
 * No index. The column is never filtered on — the recommender loads a
 * booking and reads it — and an index on a nullable low-cardinality column
 * that nothing queries is maintenance for nobody.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('vehicle_category', 40)->nullable()->after('passenger_count');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('vehicle_category');
        });
    }
};
