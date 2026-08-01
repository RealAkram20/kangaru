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
        Schema::create('rate_cards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->text('description')->nullable();
            $table->string('status')->default('active');

            // Which card invoice generation reaches for when the caller does
            // not name one. Not a unique index: MySQL cannot express "at most
            // one true row per tenant", so RateCardService demotes the
            // previous default inside the same transaction that promotes the
            // new one.
            $table->boolean('is_default')->default(false);

            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'is_default']);
            // A tenant's rate cards are named things a human picks between,
            // so two cards called "Standard" is a data-entry error, not a
            // scenario.
            //
            // Deliberately NOT scoped to live rows by adding deleted_at to
            // the key: MySQL treats NULLs in a unique index as distinct, so
            // (tenant, name, NULL) would happily insert twice and the
            // constraint would silently guarantee nothing. A soft-deleted
            // card therefore keeps its name reserved, which for a document
            // that issued invoices point at is the safer direction.
            $table->unique(['tenant_id', 'name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('rate_cards');
    }
};
