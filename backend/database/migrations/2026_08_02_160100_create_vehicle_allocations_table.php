<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Vehicles supplied to the Bank" — as a contract, not as ownership
     * (ADR-0005).
     *
     * Centenary Bank's letter (CRDB/CS/F/26) asks about "all vehicles
     * supplied to the Bank". That is an allocation for a period, and the
     * old schema modelled it as `vehicles.tenant_id` — which made it
     * permanent, exclusive and indistinguishable from ownership. A vehicle
     * on hire to the Bank this quarter and doing hailing work the next
     * could not be expressed at all.
     *
     * Carries `tenant_id` because an allocation genuinely is the client's
     * business — unlike the vehicle itself, which is Shanitah's.
     */
    public function up(): void
    {
        Schema::create('vehicle_allocations', function (Blueprint $table) {
            $table->id();

            $table->foreignId('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // Dates, not timestamps: a hire contract runs from a day to a
            // day, and storing an instant would invite timezone questions
            // nobody asked.
            $table->date('starts_on');
            // Null means open-ended, which is the common case — the Bank's
            // contract has no stated end.
            $table->date('ends_on')->nullable();

            $table->text('notes')->nullable();
            $table->foreignId('created_by_user_id')->constrained('users')->restrictOnDelete();

            $table->timestamps();

            // The dispatch question is "what is this client allocated
            // today", and the reporting question is "where has this vehicle
            // been", so both directions are indexed.
            $table->index(['tenant_id', 'starts_on', 'ends_on']);
            $table->index(['vehicle_id', 'starts_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_allocations');
    }
};
