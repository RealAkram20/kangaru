<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * AGENTS.md: "Rate cards are versioned and immutable once used. Editing
     * creates a new version; historical invoices keep their version
     * reference. This is what ends billing disputes."
     *
     * So the numbers live here, not on `rate_cards` — the card is the
     * long-lived name a human picks, the version is the priced contract an
     * invoice points at forever.
     */
    public function up(): void
    {
        Schema::create('rate_card_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rate_card_id')->constrained()->cascadeOnDelete();

            $table->unsignedInteger('version');

            // Which version prices a trip is decided by the trip's start
            // time against this date, so back-dating a correction is a new
            // version rather than an edit.
            $table->date('effective_from');

            // Phase 1 is single-currency (config/money.php), but an issued
            // price must never be ambiguous about what its integers meant.
            $table->char('currency', 3);

            // Modules\Billing\Enums\RoundingMode. Copied onto every invoice
            // line so a line can be recomputed without reading this row.
            $table->string('rounding_mode');

            // Waiting policy. Minutes are derived from the append-only
            // trip_events timeline (AGENTS.md), never from a column on the
            // trip; this is only the allowance subtracted from them.
            $table->unsignedInteger('free_waiting_minutes')->default(0);

            // Night window in the billing timezone (config/billing.php).
            // Both null means this version has no night rate at all.
            // Wrap-around windows (22:00 -> 06:00) are expected and handled
            // by the pricing engine.
            $table->time('night_starts_at')->nullable();
            $table->time('night_ends_at')->nullable();
            // Basis points: 12500 = 1.25x. An integer, because AGENTS.md
            // forbids floats anywhere near money and a multiplier stored as
            // 1.25 is a float by another name.
            $table->unsignedInteger('night_multiplier_bp')->default(10000);

            // Set the first time an invoice is issued against this version.
            // From that moment the row and its rates are immutable — the
            // model layer enforces it, this column is the record of why.
            $table->timestamp('locked_at')->nullable();

            $table->foreignId('created_by_user_id')->constrained('users')->restrictOnDelete();
            $table->text('notes')->nullable();

            $table->timestamps();

            $table->unique(['rate_card_id', 'version']);
            $table->index(['tenant_id', 'rate_card_id', 'effective_from']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('rate_card_versions');
    }
};
