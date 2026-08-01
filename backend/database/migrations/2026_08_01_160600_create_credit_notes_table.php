<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * AGENTS.md Integrity: "Financial mutations are append-only where
     * possible: corrections are credit notes or adjustments, never silent
     * edits to issued invoices."
     *
     * This table is the correction mechanism. There is deliberately no
     * "edit invoice" path anywhere in the module for it to compete with.
     */
    public function up(): void
    {
        Schema::create('credit_notes', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained()->restrictOnDelete();

            // Its own series, from the same locked-counter generator as
            // invoice numbers.
            $table->string('credit_note_number');

            $table->char('currency', 3);
            // Positive: the amount taken off the invoice. Storing it as a
            // negative would make every balance query a sign puzzle.
            $table->unsignedBigInteger('total_minor');

            // Required, not nullable. A credit note without a stated reason
            // is exactly the audit finding this table exists to prevent.
            $table->text('reason');

            $table->string('idempotency_key', 128);

            $table->timestamp('issued_at');
            $table->foreignId('issued_by_user_id')->constrained('users')->restrictOnDelete();

            $table->timestamps();

            $table->unique(['tenant_id', 'credit_note_number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'invoice_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('credit_notes');
    }
};
