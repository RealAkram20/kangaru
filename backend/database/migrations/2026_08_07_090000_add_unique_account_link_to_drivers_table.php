<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One account signs in as at most one driver.
     *
     * `drivers.user_id` has been nullable and unconstrained since it was
     * added, which let two driver profiles point at the same account. That
     * is not a cosmetic duplicate: `TripPolicy::transition` authorises a
     * driver-side transition by comparing `$trip->driver->user_id` to the
     * caller, so a shared account could move *both* profiles' trips —
     * including recording one driver's odometer against another's trip,
     * which is the reading the Bank's acceptance criteria rest on.
     *
     * MySQL permits many NULLs in a unique index, so unlinked profiles are
     * unaffected and the column stays nullable: a driver without an account
     * is a legitimate state (ADR-0016 §3).
     */
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->unique('user_id');
        });

        // Only ever present on a re-run after `down()`, which puts a plain
        // index back so the foreign key still has one to lean on. Leaving
        // both would have every write to `drivers` maintain two indexes on
        // the same column for no reason.
        if (Schema::hasIndex('drivers', 'drivers_user_id_index')) {
            Schema::table('drivers', function (Blueprint $table) {
                $table->dropIndex('drivers_user_id_index');
            });
        }
    }

    /**
     * The plain index goes back *before* the unique one comes off.
     *
     * `foreignId()->constrained()` leaves MySQL to index the column for the
     * foreign key, and MySQL is happy to let a unique index be that index —
     * so after `up()` there is exactly one index on `user_id` and the
     * constraint depends on it. Dropping it alone fails with
     * `1553 Cannot drop index ... needed in a foreign key constraint`,
     * which is a reversibility gate failure (AGENTS.md) and, on a real
     * deploy, a rollback that stops half way.
     *
     * Verified by running `migrate` → `migrate:rollback` → `migrate`, not
     * by reading the docs.
     */
    public function down(): void
    {
        if (! Schema::hasIndex('drivers', 'drivers_user_id_index')) {
            Schema::table('drivers', function (Blueprint $table) {
                $table->index('user_id');
            });
        }

        Schema::table('drivers', function (Blueprint $table) {
            $table->dropUnique(['user_id']);
        });
    }
};
