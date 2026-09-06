<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What a driver has earned, owes, and has been paid (ADR-0029).
     *
     * Append-only. Nothing here is ever updated or deleted; a correction is
     * a new `adjustment` that reverses an old row. The balance is the sum,
     * never a column — a single mutable number cannot answer "why", and the
     * first person to ask will be a driver disputing their pay.
     */
    public function up(): void
    {
        Schema::create('driver_ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();
            // Set on fare/commission pairs; null on payouts and adjustments,
            // which settle a balance rather than a journey.
            $table->foreignId('trip_id')->nullable()->constrained()->nullOnDelete();

            $table->string('kind', 20);

            /**
             * Signed minor units. Credit positive, debit negative, balance is
             * SUM(). A bigInteger because UGX has no subunit in practice and
             * a fleet's lifetime turnover in shillings outgrows 32 bits.
             */
            $table->bigInteger('amount_minor');
            $table->string('currency', 3)->default('UGX');

            // Carries the commission rate in force at the time (ADR-0029 §3),
            // so a later rate change cannot restate what was already earned.
            $table->string('description', 255);

            // Null for entries the platform raised itself at completion.
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // The two reads this table exists for: a driver's balance, and
            // their entries for a given day.
            $table->index(['driver_id', 'created_at']);
            $table->index(['driver_id', 'kind', 'created_at']);
            // One fare/commission pair per trip: the guard behind the
            // service's idempotency check, enforced where it cannot be raced.
            $table->unique(['trip_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_ledger_entries');
    }
};
