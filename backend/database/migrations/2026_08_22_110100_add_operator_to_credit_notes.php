<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The table F0 missed (ADR-0055 §6).
 *
 * F0 put `operator_id` on `trips`, `bookings` and `invoices` and stopped there.
 * `credit_notes` draws from the same document-number machinery — its own
 * counter, keyed the same way — so the moment invoice series became per-fleet,
 * a credit note had a fleet-keyed counter to draw from and no fleet to name.
 *
 * Found by threading the fleet through `CreditNoteService` rather than by
 * re-reading the plan, which is the honest version of how omissions in a
 * six-table list get noticed.
 *
 * Nullable and backfilled to Shanitah, exactly as `invoices` was: NOT NULL is
 * the eventual truth for both, and both get it in the same later pass, with
 * the writers that satisfy it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credit_notes', function (Blueprint $table) {
            $table->unsignedBigInteger('operator_id')->nullable()->after('tenant_id');
            $table->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
        });

        DB::table('credit_notes')->update(['operator_id' => 1]);
    }

    public function down(): void
    {
        Schema::table('credit_notes', function (Blueprint $table) {
            $table->dropForeign(['operator_id']);
            $table->dropColumn('operator_id');
        });
    }
};
