<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Zone pricing — the billing half of ADR-0021.
     *
     * PROJECT.md, Rate Cards: "Independent pricing per corporate client:
     * vehicle type, zone, distance, waiting charges..." The vehicle-type
     * half shipped with `rate_card_rates`; `zone` was left as a comment on
     * `invoice_lines.zone` reading "reserved for the geofencing engine".
     * ADR-0021 built the engine, so this is the half that was waiting.
     *
     * ## Why a second table rather than a nullable `zone_id` on
     * `rate_card_rates`
     *
     * The obvious move is to add `zone_id` to `rate_card_rates` and widen
     * its unique key to `(version, vehicle_category, zone_id)`. It is wrong
     * here, and for a reason specific to SQL rather than to taste:
     *
     * **A UNIQUE index treats NULLs as distinct.** With a nullable
     * `zone_id`, `(v1, sedan, NULL)` could be inserted twice and the index
     * would not object — so the *default* rate for a category, the one that
     * prices every trip outside a priced zone, would lose the only
     * structural protection it currently has. `rateFor()` would silently
     * take whichever row came back first, and two people reading the same
     * rate card version could be quoted different prices. That is precisely
     * the dispute the versioning rules exist to end, reintroduced through a
     * schema change.
     *
     * A separate table keeps both unique keys on NOT NULL columns:
     * `rate_card_rates` stays unique on `(version, vehicle_category)`, and
     * a zone rate is unique on `(rate_card_rate_id, zone_id)`. Neither can
     * be duplicated by any writer, validated or not.
     *
     * ## Why a zone rate hangs off a rate, not off a version
     *
     * `rate_card_rate_id` rather than `(version_id, vehicle_category,
     * zone_id)` makes it **structurally impossible** to price a category in
     * a zone without also pricing it by default. A version that priced
     * sedans only inside Kampala would refuse to invoice a sedan trip from
     * Jinja — a rate card that looks configured and cannot bill. There is
     * no validation rule to forget, because the row cannot exist.
     *
     * ## Why a zone rate is a full override and not a multiplier
     *
     * A multiplier can only say "everything here costs 1.2x". Operators
     * price upcountry with a higher base fare and the *same* per-kilometre
     * rate, or a higher minimum charge and no other change. A full set of
     * columns says what is charged; a multiplier says what is charged
     * relative to somewhere else, and the relative form cannot express the
     * common case. It also keeps `invoice_lines.multiplier_bp` meaning
     * exactly one thing — the night rate — rather than a product of two
     * factors nobody can decompose from the stored line.
     *
     * ## `invoice_lines.zone_id`
     *
     * `invoice_lines.zone` already exists and holds the zone's name at
     * issue time, which is what belongs on a document. It is not enough to
     * *reproduce* the line: names are not unique and a zone can be renamed,
     * so the name cannot identify which rate row supplied the unit amount.
     * The id can. Together they satisfy AGENTS.md's "every invoice line
     * stores its inputs ... fully reproducible from stored data" — the id
     * for the arithmetic, the name for the reader.
     *
     * Both stay nullable, and null keeps the meaning it has always had on
     * this column: **the category's default rate priced this line.** Every
     * invoice issued before today reads correctly under that rule, which is
     * why the pricing engine records the zone whose rate was *applied*
     * rather than the zone the pickup merely happened to fall in.
     */
    public function up(): void
    {
        Schema::create('rate_card_zone_rates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // The default rate this overrides. Cascades with it, because a
            // zone price for a category that is no longer priced at all is
            // not a rate — it is an orphan the engine could never reach.
            $table->foreignId('rate_card_rate_id')->constrained()->cascadeOnDelete();

            // restrictOnDelete, matching `invoice_lines.rate_card_version_id`:
            // a zone that decides what somebody is charged must not vanish
            // from under a priced rate card. Zones soft-delete (ADR-0021), so
            // retiring one leaves this intact by design.
            $table->foreignId('zone_id')->constrained()->restrictOnDelete();

            // Deliberately the same five columns as `rate_card_rates`, with
            // the same defaults and the same nullable maximum. A zone rate
            // is a complete price, readable on its own; a partial override
            // would mean no single row ever states what a trip costs.
            $table->unsignedBigInteger('base_fare_minor')->default(0);
            $table->unsignedBigInteger('per_km_minor')->default(0);
            $table->unsignedBigInteger('per_waiting_minute_minor')->default(0);
            $table->unsignedBigInteger('minimum_charge_minor')->default(0);
            // Null means uncapped, never "capped at zero".
            $table->unsignedBigInteger('maximum_charge_minor')->nullable();

            $table->timestamps();

            // Both columns are NOT NULL, so this really does forbid a
            // duplicate — the property the nullable-column shape loses.
            $table->unique(['rate_card_rate_id', 'zone_id']);
        });

        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->foreignId('zone_id')->nullable()->after('zone')->constrained()->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            // Named explicitly: dropping the column first leaves MariaDB's
            // foreign key behind, and the drop then fails on the next run.
            $table->dropForeign(['zone_id']);
            $table->dropColumn('zone_id');
        });

        Schema::dropIfExists('rate_card_zone_rates');
    }
};
