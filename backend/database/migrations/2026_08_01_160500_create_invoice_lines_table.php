<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * AGENTS.md Calculation: "Every invoice line stores its inputs: rate
     * card version, zone, distance, waiting minutes, multipliers applied.
     * An invoice must be fully reproducible from stored data."
     *
     * Taken literally. The inputs below are columns, not a JSON blob, so
     * they are queryable, typed, and impossible to quietly stop writing.
     */
    public function up(): void
    {
        Schema::create('invoice_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();

            $table->unsignedInteger('line_number');
            // Modules\Billing\Enums\InvoiceLineType.
            $table->string('type');
            // Rendered at issue time, not at read time: the wording on an
            // issued document must not change when a label in the code does.
            $table->string('description');

            // --- what was charged -------------------------------------
            // Quantity is a count of the line's own unit: kilometres for a
            // distance line, minutes for a waiting line, 1 for a flat line.
            $table->decimal('quantity', 12, 2);
            $table->bigInteger('unit_amount_minor');
            // Signed: a maximum-charge adjustment is negative. This is the
            // only place in billing where a negative amount is legitimate,
            // which is why rate card columns are unsigned and this is not.
            $table->bigInteger('amount_minor');

            // --- the inputs that produced it ---------------------------
            $table->foreignId('rate_card_version_id')->constrained()->restrictOnDelete();
            $table->string('vehicle_category');
            // Reserved for the geofencing engine (PROJECT.md). Always null
            // in this pass; the column exists so that when zone pricing
            // lands, invoices issued before it are unambiguously
            // "no zone applied" rather than "we did not record it".
            $table->string('zone')->nullable();
            $table->decimal('distance_km', 10, 2)->nullable();
            $table->unsignedInteger('waiting_minutes')->nullable();
            // Basis points, 10000 = 1.0x. Recorded on every line, including
            // the ones no multiplier touched, so "was a multiplier applied
            // here?" is answered by the data and not by inference.
            $table->unsignedInteger('multiplier_bp')->default(10000);
            // Modules\Billing\Enums\RoundingMode, copied from the rate card
            // version. AGENTS.md: "The rounding rule used is stored on the
            // invoice line."
            $table->string('rounding_mode');

            $table->timestamps();

            $table->unique(['invoice_id', 'line_number']);
            $table->index(['tenant_id', 'invoice_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('invoice_lines');
    }
};
