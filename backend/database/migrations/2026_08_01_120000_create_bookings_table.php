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
        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            // restrictOnDelete, not cascade: who requested transport is
            // audit-relevant for a bank client and must not vanish with the
            // user row (same reasoning as trips.vehicle_id/driver_id).
            $table->foreignId('requested_by_user_id')->constrained('users')->restrictOnDelete();

            // The passenger is often not the requester — a Corporate Admin
            // books on behalf of staff, so this is free text rather than a
            // second users FK (Company employees are a later pass).
            $table->string('passenger_name');
            $table->string('passenger_phone');
            $table->unsignedTinyInteger('passenger_count')->default(1);

            $table->string('origin');
            $table->string('destination');
            // NULL means "immediate" — PROJECT.md Booking Management lists
            // immediate and scheduled bookings as one resource, and a
            // nullable column keeps them one queue for the dispatcher
            // rather than two tables that must be merged on every read.
            $table->timestamp('scheduled_for')->nullable();

            // Validated string cast to BookingStatus on the model — same
            // convention as trips.status and vehicles.category.
            $table->string('status')->default('pending');

            $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            // Covers rejection and cancellation alike; which one applies is
            // carried by `status`.
            $table->text('decision_reason')->nullable();
            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'scheduled_for']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('bookings');
    }
};
