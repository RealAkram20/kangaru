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
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            // AGENTS.md Database Standards: "UUIDs where external references
            // are exposed." The invoice number is the human reference; this
            // is the machine one, so a URL never leaks a tenant's invoice
            // volume through a sequential id.
            $table->uuid('uuid')->unique();

            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // Rendered by Modules\Billing\Services\DocumentNumberGenerator
            // under a locked counter row. Unique per tenant: a duplicate is
            // an audit finding, so the database refuses one even if the
            // generator is ever bypassed.
            $table->string('invoice_number');

            // Phase 1 issues one invoice per completed trip. Monthly
            // consolidated invoicing is deferred (Modules/Billing/README.md),
            // and when it lands this becomes nullable with a line-level trip
            // reference — additive, per the zero-downtime rule.
            //
            // restrictOnDelete: an invoice must never lose the trip that
            // justifies it. Trips soft-delete anyway.
            $table->foreignId('trip_id')->constrained()->restrictOnDelete();

            // The exact priced contract this invoice was computed from.
            // restrictOnDelete for the same reason — without it the invoice
            // stops being reproducible, which is the whole point.
            $table->foreignId('rate_card_version_id')->constrained()->restrictOnDelete();

            $table->char('currency', 3);
            // Sum of the lines. Stored rather than derived so a report never
            // has to re-add an issued document, and so a mismatch between
            // this and the lines is detectable rather than invisible.
            $table->bigInteger('total_minor');

            // AGENTS.md Integrity: "every mutation carries an idempotency
            // key; replays return the original result, never a duplicate."
            // The unique index is the guarantee — InvoiceService's
            // look-before-write is only the fast path.
            $table->string('idempotency_key', 128);

            $table->timestamp('issued_at');
            $table->foreignId('issued_by_user_id')->constrained('users')->restrictOnDelete();
            $table->text('notes')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'invoice_number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            // One invoice per trip. Without this, the same trip billed under
            // two different idempotency keys would produce two valid-looking
            // invoices for one journey — the failure mode a client notices
            // and a replay guard alone does not catch.
            $table->unique('trip_id');

            $table->index(['tenant_id', 'issued_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
