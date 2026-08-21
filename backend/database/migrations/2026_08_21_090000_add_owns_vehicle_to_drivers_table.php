<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whose vehicle it is (ADR-0048 §7).
     *
     * `drivers.vehicle_id` has been unable to answer this since ADR-0009, and
     * its own docblock says so without resolving it: a corporate driver
     * "takes whatever the depot hands them", a boda rider's machine "is not
     * separable from the driver at all", **and both set the same column to
     * the same kind of value.**
     *
     * The difference is not cosmetic. It decides who insures the vehicle, who
     * repairs it, whether it leaves when the driver does, and — the reason
     * this landed with the document work — whether `vehicle_registration` and
     * `vehicle_insurance` are the driver's papers or the platform's.
     *
     * **Deliberately not derived from `vehicle_id !== null`.** That
     * derivation answers "has a vehicle", which is a question nobody asked
     * and which a depot driver answers `true` to every morning.
     *
     * Defaults false because the fleet that exists today is the platform's:
     * every row already in this table is a driver in a Shanitah vehicle, and
     * backfilling them to `true` would assert something about each of them
     * that nobody checked.
     *
     * **This flag gates nothing.** No offer, no dispatch decision, no
     * document requirement reads it yet — the same record-before-enforcement
     * split ADR-0033 §6 made, for the same reason.
     */
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->boolean('owns_vehicle')->default(false)->after('vehicle_id');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn('owns_vehicle');
        });
    }
};
