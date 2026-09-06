<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The distance a trip *would* be billed on, and how much that figure can be
 * trusted (`docs/measured-distance-plan.md` §3, ADR-0045).
 *
 * Three columns beside the two that already exist:
 *
 * - `distance_km` stays what it is — the odometer delta, and still what
 *   `TripPricingEngine` prices from. Nothing in this migration changes a fare.
 * - `gps_distance_km` stays the raw haversine watchdog.
 * - `billed_distance_km` is the resolver's answer: the map-matched trace when
 *   it is trustworthy, the odometer held inside the road's corridor when it
 *   is not. **Nothing reads it yet.** Phase 1 of the plan runs the resolver
 *   in shadow so the grade distribution is known before money depends on it;
 *   Phase 2 points the pricing engine at this column.
 * - `distance_grade` is `A`, `B` or `C` — verified, bounded, held — and is the
 *   thing an invoice line will one day print and a review queue will one day
 *   filter on. CHAR(1) rather than an enum column so a fourth grade is a code
 *   change, not a schema change.
 * - `distance_resolved_at` says whether the resolver has run at all. Null on
 *   every trip that completed before this shipped, and on a trip whose
 *   resolution is still queued behind its grace period.
 *
 * All nullable, all additive; the zero-downtime rule's first step and, for
 * now, its only one. The full record of *why* a trip got its figure lives in
 * `trip_distance_evidence`, one row per resolution.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->decimal('billed_distance_km', 8, 2)->nullable()->after('distance_variance_flagged');
            $table->char('distance_grade', 1)->nullable()->after('billed_distance_km');
            $table->timestamp('distance_resolved_at')->nullable()->after('distance_grade');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn(['billed_distance_km', 'distance_grade', 'distance_resolved_at']);
        });
    }
};
