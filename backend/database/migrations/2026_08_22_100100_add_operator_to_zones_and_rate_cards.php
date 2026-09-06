<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Service areas and prices, which already had a client axis (ADR-0055).
 *
 * Zones and rate cards differ from settings and vehicle categories in one way
 * that changes the backfill: both already carry `tenant_id`, and a client's own
 * zone or rate card is not a default anybody inherits.
 *
 * ## Where the existing rows go, and why they do not all go to the same place
 *
 * - **Zones → operator 1.** A service area is the fleet's own. Every zone on
 *   the platform today is Shanitah's operating patch, and fleet two must not
 *   inherit it by finding it sitting at the Kangaru level. Kangaru may ship
 *   defaults later; none exist now, and inventing some by backfill would be
 *   putting words in somebody's mouth.
 * - **Corporate rate cards → operator 1.** A card that prices a client's work
 *   belongs to the fleet doing the work — Shanitah, today, for all of them.
 * - **The walk-in tariff stays null.** `create_the_walk_in_tariff` made
 *   `rate_cards.tenant_id` nullable so a card with no client *is* the public
 *   tariff, and ADR-0055 §5 keeps that price Kangaru's: Kangaru owns the
 *   walk-in customer, so Kangaru sets what the walk-in pays. Fleets price their
 *   own corporate clients and nobody prices a walk-in but Kangaru.
 *
 * So the predicate that separates them is the client column, and it reads
 * exactly as the rule does: a card with a client is a fleet's, a card without
 * one is Kangaru's.
 *
 * ## Versions and rates are not touched
 *
 * `rate_card_versions` and `rate_card_rates` carry `tenant_id` because
 * `TripPricingEngine` walks all three, but they have no ownership of their own
 * — they belong to the card, and the card now names a fleet. Adding the column
 * to them would be a second answer to one question, and the two would drift the
 * first time somebody re-parented a version.
 *
 * ## No uniqueness change is needed here
 *
 * Neither table has a unique key that `operator_id` belongs in. `rate_cards` is
 * `unique(tenant_id, name)`, which is about what a human picks between inside
 * one client's list; a fleet does not change that question. Zones have no
 * unique key at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['zones', 'rate_cards'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('operator_id')->nullable()->after('tenant_id');
                $blueprint->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
            });
        }

        // Every zone that exists is Shanitah's patch, client-specific or not.
        DB::table('zones')->update(['operator_id' => 1]);

        // A card with a client is that client's fleet's work; a card without
        // one is the public tariff and stays Kangaru's.
        DB::table('rate_cards')->whereNotNull('tenant_id')->update(['operator_id' => 1]);
    }

    public function down(): void
    {
        foreach (['zones', 'rate_cards'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['operator_id']);
                $blueprint->dropColumn('operator_id');
            });
        }
    }
};
