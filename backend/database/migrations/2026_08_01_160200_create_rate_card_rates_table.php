<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * PROJECT.md, Rate Cards: "Independent pricing per corporate client:
     * vehicle type, zone, distance, waiting charges..." — the per-vehicle-
     * type half of that. Zone pricing is deferred with the geofencing
     * engine; see Modules/Billing/README.md.
     */
    public function up(): void
    {
        Schema::create('rate_card_rates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rate_card_version_id')->constrained()->cascadeOnDelete();

            // Matches vehicles.category, which is a validated string rather
            // than a reference table in Phase 1 (see Modules/Vehicles).
            $table->string('vehicle_category');

            // Every amount is an integer in the currency's minor unit
            // (AGENTS.md Representation). For UGX that is whole shillings.
            $table->unsignedBigInteger('base_fare_minor')->default(0);
            $table->unsignedBigInteger('per_km_minor')->default(0);
            $table->unsignedBigInteger('per_waiting_minute_minor')->default(0);
            $table->unsignedBigInteger('minimum_charge_minor')->default(0);
            // Null means uncapped. Zero would mean "every trip is free",
            // which is why this is nullable rather than defaulted.
            $table->unsignedBigInteger('maximum_charge_minor')->nullable();

            $table->timestamps();

            $table->unique(['rate_card_version_id', 'vehicle_category']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('rate_card_rates');
    }
};
