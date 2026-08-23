<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What Kangaru and the fleet take from a walk-in fare (ADR-0063 §3).
 *
 * ## On the contract, not on the plan
 *
 * These are terms between **three** parties — Kangaru, a driver, and that
 * driver's fleet. A fleet's subscription plan (ADR-0058) is a two-party
 * agreement, and putting a commission rate there would mean editing a tier
 * silently repriced every existing driver agreement underneath it.
 *
 * ## Basis points, matching `night_multiplier_bp`
 *
 * One convention for proportions across the codebase. 1500 bp is 15%.
 *
 * ## Not nullable, and defaulted rather than left to the caller
 *
 * A null rate is a fare somebody has to interpret, and every interpretation of
 * "no rate" is a guess about money. The defaults are the platform's opening
 * position; a contract may carry different ones, which is the entire reason
 * they live on the row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('driver_walk_in_contracts', function (Blueprint $table) {
            $table->unsignedInteger('kangaru_commission_bp')->default(1500)->after('status');

            // ADR-0063 §2: the fleet's share is for the **vehicle**. A
            // driver-partner has no fleet asset and no fleet to pay, so their
            // contract carries a rate that is never applied — rather than a
            // null that a settlement would have to interpret.
            $table->unsignedInteger('fleet_share_bp')->default(1000)->after('kangaru_commission_bp');
        });
    }

    public function down(): void
    {
        Schema::table('driver_walk_in_contracts', function (Blueprint $table) {
            $table->dropColumn(['kangaru_commission_bp', 'fleet_share_bp']);
        });
    }
};
