<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A rate card the platform owns, and a fare recorded on the trip
 * (ADR-0026).
 *
 * ## The tariff
 *
 * `rate_cards.tenant_id` becomes nullable, and a card with no tenant is the
 * public tariff. Its versions and rates follow, because both carry the same
 * column and `TripPricingEngine` walks all three.
 *
 * The fourth time this schema has done it — `drivers`, `vehicles`,
 * `order_requests` and `trips` all use a null tenant to mean "the
 * platform's" (ADR-0005). A separate `walk_in_tariffs` table would have
 * been a second definition of what a price is, with its own versioning and
 * its own zone overrides, drifting from the first the day somebody changed
 * one.
 *
 * ## The fare
 *
 * Recorded on the trip rather than in `invoices`. That ledger answers "what
 * does this client owe", is keyed per tenant and carries a document number
 * series a walk-in has no place in — `InvoiceService` already refuses a
 * walk-in trip for exactly that reason. A cash fare in a taxi is not an
 * invoice.
 *
 * `fare_rate_card_version_id` is what makes the amount reproducible: the
 * version is frozen once used, so the same inputs re-derive the same fare
 * years later. Storing only the total would leave a number nobody could
 * defend in a dispute, which is the failure AGENTS.md's versioning rule
 * exists to prevent.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Dropped and re-added rather than altered in place: `change()` on a
        // column carrying a foreign key needs the constraint gone first on
        // MySQL/MariaDB, and re-adding it is how the referential guarantee
        // comes back rather than being quietly lost.
        foreach (['rate_cards', 'rate_card_versions', 'rate_card_rates'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['tenant_id']);
            });

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreignId('tenant_id')->nullable()->change();
            });

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            });
        }

        Schema::table('trips', function (Blueprint $table) {
            // Minor units, like every other amount in this platform. UGX is
            // zero-decimal so the minor unit *is* the shilling — but the
            // column is named for the convention rather than the currency,
            // because a float near money is the bug AGENTS.md forbids and
            // the name is what stops somebody storing 15.5 here.
            $table->unsignedBigInteger('fare_minor')->nullable()->after('distance_variance_flagged');

            // Stored beside the amount rather than assumed. A fare with no
            // currency is a number, and the platform crossing a border is a
            // schema change nobody should have to make twice.
            $table->string('fare_currency', 3)->nullable()->after('fare_minor');

            // What priced it. Without this the total is undefendable: the
            // tariff moves, and "why was I charged this" has no answer.
            $table->foreignId('fare_rate_card_version_id')
                ->nullable()
                ->after('fare_currency')
                ->constrained('rate_card_versions')
                ->nullOnDelete();

            $table->dateTime('fare_computed_at')->nullable()->after('fare_rate_card_version_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['fare_rate_card_version_id']);
            $table->dropColumn(['fare_minor', 'fare_currency', 'fare_rate_card_version_id', 'fare_computed_at']);
        });

        // A tariff row has no tenant to return to, and inventing one would
        // file the public prices under a client. Refuse rather than guess —
        // the same stance the ADR-0024 migrations take.
        foreach (['rate_card_rates', 'rate_card_versions', 'rate_cards'] as $table) {
            $orphans = DB::table($table)->whereNull('tenant_id')->count();

            if ($orphans > 0) {
                throw new RuntimeException(
                    "Cannot roll back: {$orphans} row(s) in {$table} belong to the platform tariff and have "
                    .'no tenant to return to. Deal with them explicitly before reversing ADR-0026.'
                );
            }

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['tenant_id']);
            });

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreignId('tenant_id')->nullable(false)->change();
            });

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            });
        }
    }
};
