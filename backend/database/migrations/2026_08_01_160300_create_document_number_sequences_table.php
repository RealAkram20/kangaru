<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * AGENTS.md Integrity: "Invoice numbers are sequential per tenant,
     * generated inside a transaction with a locked counter row. Gaps and
     * duplicates are both audit findings for bank clients."
     *
     * This is that counter row. It exists as its own table rather than a
     * MAX(invoice_number)+1 query for the reason the Dispatch guard locks
     * vehicle rows rather than trip rows: you cannot take a row lock on
     * rows that do not exist yet, and two concurrent generators both
     * reading MAX() find the same answer.
     *
     * One row per (tenant, document type, year). Sequences restart each
     * year — still strictly sequential per tenant, and the year is carried
     * in the rendered number so a restart is never mistaken for a gap.
     */
    public function up(): void
    {
        Schema::create('document_number_sequences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // 'invoice' | 'credit_note'. A plain string rather than an enum
            // cast: nothing reads this column except the generator's own
            // WHERE clause.
            $table->string('document_type');
            $table->unsignedSmallInteger('year');

            $table->unsignedBigInteger('next_number')->default(1);

            $table->timestamps();

            // The lock target. Unique so the generator's insert-then-lock
            // can rely on exactly one row existing per series, whichever of
            // two racing processes created it.
            $table->unique(['tenant_id', 'document_type', 'year']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('document_number_sequences');
    }
};
