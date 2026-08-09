<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A job offered to a driver, before any trip exists (ADR-0024 §3).
 *
 * ## Why this table exists rather than a Trip in `assigned`
 *
 * `DispatchService::assign` writes a Trip, and the driver's accept is a
 * transition on a row that already holds their vehicle. For a corporate
 * booking dispatched by a human that is fine — somebody decided, and the
 * van is spoken for. For hailing it is wrong in two specific ways:
 *
 * 1. A trip in `assigned` **occupies its vehicle**
 *    (`TripStatus::occupiesVehicle`). Creating one to represent an
 *    unanswered offer takes a real van out of the fleet for as long as a
 *    driver ignores their phone — and offering the same job to a second
 *    driver would need a second trip on the same vehicle, which
 *    `TripAssignmentGuard` correctly refuses. The offer model would be
 *    impossible to express.
 * 2. A declined offer would leave a `rejected` trip carrying an odometer, an
 *    events timeline and a place in the billing lifecycle, for a journey
 *    that never had a driver. `trip_events` is evidence; it should not fill
 *    up with trips nobody drove.
 *
 * So an offer is its own row, and **`trips` is not written until somebody
 * accepts** — through `TripService::create`, which takes the same
 * pessimistic locks every other assignment path takes. There is still
 * exactly one way a vehicle and driver get onto a trip.
 *
 * ## No tenant column
 *
 * Deliberately, like `order_requests`, `customers` and `drivers` before it
 * (ADR-0005): a walk-in is the platform's customer, and an offer to one of
 * the platform's drivers belongs to no client.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispatch_offers', function (Blueprint $table) {
            $table->id();

            // What is being offered. Nullable and left open for a second
            // kind of source: ADR-0024 covers walk-ins only, and corporate
            // bookings keep their existing human-driven path untouched. When
            // a booking-shaped offer arrives it is a sibling column, not a
            // reinterpretation of this one.
            $table->foreignId('order_request_id')->nullable()->constrained()->cascadeOnDelete();

            // Who it went to. restrictOnDelete, matching `trips`: an offer
            // is the record of a decision made about a person, and it must
            // not vanish because their profile was removed.
            $table->foreignId('driver_id')->constrained()->restrictOnDelete();

            // The vehicle they would bring. Nullable — presence records a
            // driver on duty before the depot has issued keys, and dispatch
            // ranks them anyway (ADR-0020's rule: report a missing input,
            // never guess it). An offer with no vehicle cannot be accepted,
            // and the accept path says so.
            $table->foreignId('vehicle_id')->nullable()->constrained()->restrictOnDelete();

            // Validated string, not a DB enum — the same convention as
            // `trips.status` and `vehicles.category`. Cast on the model.
            $table->string('status')->default('offered');

            // Which wave this belonged to, and where in it. Both stored
            // rather than derived: they are the audit of *why this driver*,
            // and a ranking nobody can reconstruct is one an operator
            // overrides on instinct (ADR-0020 §4).
            $table->unsignedSmallInteger('round')->default(1);
            $table->unsignedSmallInteger('rank')->default(1);
            $table->decimal('score', 10, 2)->nullable();
            $table->decimal('pickup_distance_km', 8, 2)->nullable();
            // The sentences ADR-0020 §4 requires: "About 0.4 km from the
            // pickup", "This driver has not reported a position".
            $table->json('reasons')->nullable();

            $table->dateTime('offered_at');

            // Expiry is a wall clock, not a job (ADR-0024 §5). Every read
            // compares against this, so an offer is expired whether or not
            // anything ran — the scheduled command only *accelerates* the
            // hand-off to the next driver.
            $table->dateTime('expires_at');
            $table->dateTime('responded_at')->nullable();
            $table->string('decline_reason', 255)->nullable();

            // Set on accept. The link `OrderRequestStatus::CONVERTED` was
            // promised and never given: its docblock says "when that lands,
            // this case gains a foreign key rather than a new meaning".
            $table->foreignId('trip_id')->nullable()->constrained()->nullOnDelete();

            $table->timestamps();

            // The driver app's list: "what am I being offered right now".
            $table->index(['driver_id', 'status', 'expires_at']);
            // The matcher's own read: "is this order still out with
            // somebody, and has it come back".
            $table->index(['order_request_id', 'status']);
            // The sweep in `dispatch:advance-offers`: everything live and
            // past its clock, across all orders.
            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispatch_offers');
    }
};