<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which witness a contract bills on (ADR-0045 §3; Phase 2 of
 * `docs/measured-distance-plan.md`).
 *
 * `gps_primary`, `route_capped` or `odometer` — see
 * `Modules\Trips\Distance\DistancePolicy`. On the rate card *version*, not
 * in settings, because it is a commercial term: one client's contract may
 * name the odometer as its evidence while the walk-in tariff prices from the
 * measured trace, and a versioned, immutable rate card is what stops
 * changing the policy tomorrow from restating an invoice issued today.
 *
 * **Defaults to `odometer`, on every existing version and every new one that
 * does not say otherwise.** That is today's behaviour: the resolver's figure
 * under the odometer policy *is* the odometer delta, so pointing the pricing
 * engine at `billed_distance_km` changes no fare until an operator issues a
 * version that says `gps_primary`. The flip is a rate-card action, dated and
 * reversible by issuing another — never a deploy.
 *
 * A string column rather than a database enum, matching `rounding_mode`
 * beside it: the enum lives in code, where adding a case is a code change
 * and not a schema change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rate_card_versions', function (Blueprint $table) {
            $table->string('distance_policy', 20)->default('odometer')->after('night_multiplier_bp');
        });
    }

    public function down(): void
    {
        Schema::table('rate_card_versions', function (Blueprint $table) {
            $table->dropColumn('distance_policy');
        });
    }
};
