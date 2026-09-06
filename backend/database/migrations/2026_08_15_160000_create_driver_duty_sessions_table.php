<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per shift: when a driver went on duty and when they came off
 * (ADR-0038).
 *
 * ## This is not the presence history ADR-0024 §2 refused
 *
 * `create_driver_presence_table` rules out keeping a history in as many
 * words — "a second 500M-row table answering a question nobody has" — and
 * that objection is about *telemetry*: a row per heartbeat, per driver,
 * carrying coordinates, answering "where was this driver at 11:04".
 *
 * This table takes **two rows per driver per day** and holds no position at
 * all. A thousand drivers working every day produce under a million rows a
 * year. The privacy property that objection was protecting — that where
 * somebody was when they signed off is usually where they live — is
 * untouched here, because there is nowhere in this table to put it.
 *
 * `driver_presence` keeps its job unchanged: it is the live snapshot the
 * matcher ranks against. This is the log of shifts beside it.
 *
 * ## Why `last_seen_at` is here rather than read from presence
 *
 * The sweep that closes an abandoned session needs the last heartbeat, and
 * `DatabaseDriverPresenceStore::setDuty()` **nulls `recorded_at`** on the way
 * off duty — destroying it at exactly the moment it would be wanted. The
 * presence store is also swappable for Redis, and history that depends on
 * which cache an environment happens to run is not history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_duty_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            // Which vehicle the shift was worked with, as known at sign-on.
            //
            // nullOnDelete rather than cascade, matching `driver_presence`:
            // a vehicle leaving the fleet must not delete the record of
            // shifts somebody actually worked. A shift with a forgotten
            // vehicle is still a shift.
            $table->foreignId('vehicle_id')->nullable()->constrained()->nullOnDelete();

            $table->dateTime('started_at');

            // Null means *open* — the driver is on duty now. Exactly one open
            // session per driver is an invariant `DutySessionService` keeps;
            // it is not expressible as a unique index, because MySQL treats
            // every NULL as distinct.
            $table->dateTime('ended_at')->nullable();

            // The last heartbeat this shift received. Null until the first
            // one arrives, which is the window between going on duty and the
            // app's first position — `DutySessionService::secondsIn()` falls
            // back to `started_at` there rather than treating it as stale.
            $table->dateTime('last_seen_at')->nullable();

            // How the shift ended, so a figure a driver disputes can be
            // explained. `driver` is the button; `stale` is the sweep, and it
            // is the one worth being able to point at.
            $table->string('ended_reason', 20)->nullable();

            $table->timestamps();

            // The read this table exists for: one driver's shifts overlapping
            // a window. Leading with the driver, because every question asked
            // of it is about one person.
            $table->index(['driver_id', 'started_at']);

            // The sweep's read: every open session, across all drivers. A
            // partial index would be better and MySQL has none, so this is an
            // index on a column that is null for the overwhelming majority of
            // rows — which is exactly the shape that makes the scan cheap.
            $table->index(['ended_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_duty_sessions');
    }
};
