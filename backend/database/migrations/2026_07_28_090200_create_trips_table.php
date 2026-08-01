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
        Schema::create('trips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            // restrictOnDelete, not cascade: a vehicle/driver with trip
            // history is audit-relevant data (the Bank's six data points)
            // — it must not vanish silently if the vehicle/driver row is
            // deleted.
            $table->foreignId('vehicle_id')->constrained('vehicles')->restrictOnDelete();
            $table->foreignId('driver_id')->constrained('drivers')->restrictOnDelete();
            $table->string('origin');
            $table->string('destination');
            // Validated string, not a DB enum — same convention as
            // vehicles.category. Cast to TripStatus on the model.
            $table->string('status')->default('assigned');

            // Odometer Capture (AGENTS.md). Driver-entered value + dashboard
            // photo, captured at Trip Started / Trip Completed. Photo
            // upload endpoint is deferred — *_photo_path stays null until
            // that pass ships (see Modules/Trips/README.md).
            $table->unsignedInteger('odometer_start')->nullable();
            $table->string('odometer_start_photo_path')->nullable();
            $table->unsignedInteger('odometer_end')->nullable();
            $table->string('odometer_end_photo_path')->nullable();

            // Distance reconciliation (AGENTS.md Odometer Capture + ADR-0003).
            // distance_km is computed by the state machine at Trip
            // Completed. gps_distance_km / distance_variance_flagged are
            // schema-ready placeholders only — populated once the Redis/
            // trip_locations GPS pipeline exists; comparison logic is a
            // deferred no-op until then.
            $table->decimal('distance_km', 8, 2)->nullable();
            $table->decimal('gps_distance_km', 8, 2)->nullable();
            $table->boolean('distance_variance_flagged')->default(false);

            // Bank's date/time acceptance criterion — set only by the
            // state machine, never editable via a raw update endpoint.
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();

            // Captured at Cancelled; the actual charge amount is computed
            // by the (not-yet-built) Billing module from the rate card.
            $table->boolean('cancellation_charge_applicable')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'vehicle_id']);
            $table->index(['tenant_id', 'driver_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trips');
    }
};
