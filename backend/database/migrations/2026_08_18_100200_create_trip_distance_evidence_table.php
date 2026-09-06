<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Why a trip got the distance it got (`docs/measured-distance-plan.md` §3,
 * ADR-0045).
 *
 * One row per resolution, append-only, like `trip_events` and for the same
 * reason: this is the evidence behind a figure that will be invoiced to a
 * bank and paid to a driver, and evidence that can be edited afterwards is
 * worth nothing in either argument. A trip resolved twice — because late
 * pings arrived, or an operator forced it — has two rows, and the trip's own
 * `billed_distance_km` reflects the latest. The earlier row is not deleted;
 * it is the record of what the platform believed before it knew more.
 *
 * ## Every input, not just the answer
 *
 * The four witnesses (`odometer_km`, `gps_km` split into what was matched and
 * what was inferred across gaps, `route_km`), the quality numbers the
 * decision turned on (`coverage_percent`, `inferred_share_percent`, the
 * `dropped` tally by reason), the policy applied, and — deliberately — the
 * `thresholds` **as they stood at the time**. Thresholds are operator
 * settings and will change; a row that recorded only "grade B" against a
 * corridor nobody can reconstruct is a fare nobody can defend. This is the
 * "every invoice line stores its inputs" rule of AGENTS.md applied to the
 * step before the invoice.
 *
 * `matched_polyline` is the snapped trace, so the console can draw what was
 * measured beside what was routed. MEDIUMTEXT: an upcountry trace snapped
 * to roads is tens of kilobytes, well past TEXT's 64 KB on a bad day.
 *
 * `tenant_id` is nullable, like `trip_events.tenant_id` and for the same
 * reason (ADR-0024 §1): a walk-in trip belongs to the platform, not to a
 * client, and its evidence goes with it. `TenantScope` never matches NULL, so
 * a client cannot read a walk-in's row through any scoped query.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_distance_evidence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('trip_id')->constrained()->cascadeOnDelete();
            $table->timestamp('resolved_at');

            // The answer.
            $table->string('policy', 20);
            $table->char('grade', 1);
            $table->decimal('billed_km', 8, 2);
            // One sentence a reviewer can read: which branch decided, and on
            // what. Prose here rather than a code, because the code is
            // reconstructible from the columns and the sentence is what the
            // review queue shows.
            $table->string('reason', 255);

            // The witnesses.
            $table->decimal('odometer_km', 8, 2)->nullable();
            $table->decimal('gps_km', 8, 2)->nullable();
            $table->decimal('matched_km', 8, 2)->nullable();
            $table->decimal('inferred_km', 8, 2)->nullable();
            $table->decimal('haversine_km', 8, 2)->nullable();
            $table->decimal('route_km', 8, 2)->nullable();
            // Where the reference route's endpoints came from: the order's
            // pins, or the matched trace's own ends when the trip has none.
            $table->string('reference_source', 20)->nullable();

            // The quality numbers the decision turned on.
            $table->decimal('coverage_percent', 5, 2)->nullable();
            $table->decimal('inferred_share_percent', 5, 2)->nullable();
            $table->unsignedInteger('pings_total');
            $table->unsignedInteger('pings_kept');
            $table->unsignedInteger('gaps_routed');
            $table->json('dropped');

            // How it was measured, and with what.
            $table->string('provider', 20)->nullable();
            $table->mediumText('matched_polyline')->nullable();
            $table->json('thresholds');

            $table->timestamp('created_at')->nullable();

            // The console's question is "the latest resolution of this trip",
            // and the report's is "every resolution in a period".
            $table->index(['trip_id', 'resolved_at']);
            $table->index(['tenant_id', 'resolved_at']);
            $table->index(['grade', 'resolved_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_distance_evidence');
    }
};
