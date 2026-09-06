<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What a passenger thought of the ride (ADR-0030).
     *
     * One per trip, written once by the customer who took it, never edited.
     * `driver_id` is denormalised on purpose: it is the query this table
     * exists to serve, and a trip's driver can be reassigned — which must
     * not move a rating from the person who earned it to somebody who did
     * not.
     */
    public function up(): void
    {
        Schema::create('trip_ratings', function (Blueprint $table) {
            $table->id();
            // Unique: the "already rated" refusal, enforced by the database
            // rather than only by a check the service could lose a race on.
            $table->foreignId('trip_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            $table->unsignedTinyInteger('stars');
            // For the office, not for the driver (ADR-0030 §6).
            $table->string('comment', 500)->nullable();

            $table->timestamps();

            // The driver's score: the most recent N for one driver.
            $table->index(['driver_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_ratings');
    }
};
