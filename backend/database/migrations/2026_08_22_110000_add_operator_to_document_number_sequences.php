<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Invoice numbers, once two fleets can bill one client (ADR-0055 §6).
 *
 * ## What breaks without this
 *
 * `document_number_sequences` is keyed `unique(tenant_id, document_type, year)`
 * — one counter per client, per document type, per year. The moment a client
 * contracts a second fleet, both fleets draw from that one counter, and
 * Centenary Bank's 2026 invoice series comes back as 1, 3, 4, 7 with the gaps
 * sitting in a competitor's ledger.
 *
 * A missing invoice number is not a cosmetic defect for this platform. The
 * product's claim is that every invoice is reproducible from stored data, and
 * an auditor asked to explain the gaps would be told that another company holds
 * them — which is both true and unacceptable.
 *
 * ## The counter is deliberately not an Eloquent model
 *
 * `DocumentNumberSequenceRepository` says so in its own words: *"it is a
 * counter, and the only things that ever touch it are the three statements in
 * this class."* So there is no global scope to lean on here and no
 * `BelongsToOperator` to add — the fleet is written explicitly into those three
 * statements, which is the ADR-0001 repository exception being used exactly as
 * it was meant to be.
 *
 * ## NOT NULL, unlike most of this pass
 *
 * Every other `operator_id` added by F0 and F1 is nullable, because a null
 * means something on those tables — Kangaru's default, or an unclaimed
 * walk-in. Here it means nothing at all: a counter belongs to the fleet issuing
 * the document, and there is no such thing as a fleetless invoice series. The
 * walk-in fare is not an invoice — `InvoiceService` already refuses a walk-in
 * trip, and `create_the_walk_in_tariff` records why — so no row here is ever
 * Kangaru's.
 *
 * Backfilled to Shanitah, which every existing series is.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_number_sequences', function (Blueprint $table) {
            $table->unsignedBigInteger('operator_id')->nullable()->after('tenant_id');
        });

        DB::table('document_number_sequences')->update(['operator_id' => 1]);

        Schema::table('document_number_sequences', function (Blueprint $table) {
            $table->unsignedBigInteger('operator_id')->nullable(false)->change();
            $table->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
        });

        // ## The new key leads with `tenant_id`, and that is not cosmetic
        //
        // The old unique is the index MariaDB uses to support the `tenant_id`
        // foreign key, so dropping it fails with *"Cannot drop index … needed
        // in a foreign key constraint"* (error 1553) unless something else
        // covers that column as a **leftmost prefix**.
        //
        // `move_fleet_to_the_platform` recorded the same lesson in 2026 and
        // this migration re-learned it by failing on its first run, in exactly
        // that way, with the key written as `(operator_id, tenant_id, …)` —
        // which enforces the identical constraint but leads with the wrong
        // column and so supports nothing.
        //
        // Column order in a unique key changes no guarantee. It changes which
        // foreign keys the index can carry, which is why this one is written
        // the way it is.
        //
        // The new key also goes in **before** the old one comes out, so there
        // is no window in which two fleets could draw the same number.
        Schema::table('document_number_sequences', function (Blueprint $table) {
            $table->unique(['tenant_id', 'operator_id', 'document_type', 'year'], 'dns_client_fleet_type_year_unique');
            $table->dropUnique(['tenant_id', 'document_type', 'year']);
        });
    }

    public function down(): void
    {
        // Reversed in the same order for the same reason: the old key is put
        // back first so it can carry the `tenant_id` foreign key before the
        // new one is taken away.
        Schema::table('document_number_sequences', function (Blueprint $table) {
            $table->unique(['tenant_id', 'document_type', 'year']);
            $table->dropUnique('dns_client_fleet_type_year_unique');
        });

        Schema::table('document_number_sequences', function (Blueprint $table) {
            $table->dropForeign(['operator_id']);
            $table->dropColumn('operator_id');
        });
    }
};
