<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0012: a walk-in order request is platform data.
 *
 * Deliberately **no `tenant_id`**. Per ADR-0005 the walk-in customer is the
 * platform's own customer, so the row follows vehicles and drivers rather
 * than bookings. The alternative — a pseudo-tenant that owns walk-ins — is
 * rejected in the ADR: it would make "no tenant" impersonate a tenant and
 * haunt every tenant-facing surface with a special case.
 *
 * `details` is JSON because the three services genuinely differ in shape
 * (a ride has a passenger count, a delivery has an item type, a rental has
 * dates) and none of it is queried relationally — the queue filters on
 * status and service_type, which are real columns with real indexes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_requests', function (Blueprint $table) {
            $table->id();
            // What the visitor quotes on the phone. Short enough to read
            // aloud; unique so quoting it identifies one row.
            $table->string('reference', 12)->unique();
            $table->string('service_type', 20);
            $table->string('status', 20)->default('new');
            $table->string('contact_name', 120);
            $table->string('contact_phone', 32);
            $table->string('contact_email', 190)->nullable();
            $table->string('pickup_location')->nullable();
            $table->string('dropoff_location')->nullable();
            // Null means "as soon as you can", mirroring Booking's
            // isImmediate() convention.
            $table->dateTime('scheduled_for')->nullable();
            $table->json('details')->nullable();
            $table->text('notes')->nullable();
            $table->text('dispatcher_notes')->nullable();
            $table->foreignId('handled_by_user_id')->nullable()->constrained('users');
            $table->timestamps();

            // The queue reads "new ones first, oldest first" and filters by
            // service; both are hot paths for the dispatch screen.
            $table->index(['status', 'created_at']);
            $table->index('service_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_requests');
    }
};
