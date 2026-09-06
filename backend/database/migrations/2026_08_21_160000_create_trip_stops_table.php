<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0045 §1/§2/§4: the evidence side of multi-stop journeys.
 *
 * A stop is something a trip carries and never changes — copied from a plan
 * or added at a kerb, and from that moment historical. Every trip in the
 * database today keeps an empty list, nothing backfills, and no existing
 * screen has to learn what a stop is to keep working (§ Consequences).
 *
 * Three changes travel together because they are one fact:
 *
 * - `trip_stops` itself;
 * - `trips.unplanned_stop_count` — §4's flag, "a note, not a charge";
 * - `trip_events.stop_id` — §2 reuses `waiting ⇄ trip_resumed` for
 *   arrive/continue, and the payload names which stop the pause was about.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_stops', function (Blueprint $table) {
            $table->id();
            // Nullable for the same reason `trips.tenant_id` is: a walk-in
            // trip has no tenant (ADR-0024 §1), and its stops inherit that.
            // Copied from the trip at insert, exactly as `trip_events` does.
            $table->foreignId('tenant_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('trip_id')->constrained()->cascadeOnDelete();

            // For grouping in reports only — never read back to re-derive
            // what a trip did (§1). The place may be retired or renamed
            // later; the stop keeps the label it was created with.
            $table->foreignId('client_place_id')->nullable()->constrained()->nullOnDelete();

            // 1-based position on the run. Driver adds append; nothing
            // reorders (§7's refusal, quoted rather than re-argued).
            $table->unsignedSmallInteger('sequence');

            $table->string('label', 160);
            // Same 10,7 as `client_places`, `trip_locations` and
            // `bookings.origin_*`, so they compare without a cast. Nullable
            // as a pair: a driver in a dead zone may record "next: Ntinda
            // branch" as prose, the same honesty as a trip keyed in at the
            // desk. `TripResource::place` already refuses half a position.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();

            // planned | added_by_driver | added_by_dispatch | added_by_client
            // (§4). Who put this stop on the run — the flag the invoice note
            // and `unplanned_stop_count` are built from.
            $table->string('source', 20);
            // pending | arrived | done | skipped (§2, §6). Skipped is
            // first-class from day one even though no surface writes it yet:
            // an ATM serviced this morning keeps its row and its reason.
            $table->string('status', 20)->default('pending');

            // Real timestamps, not derived (§5): dwell per stop is
            // `departed_at - arrived_at`, written by the same transitions
            // billing derives waiting from.
            $table->timestamp('arrived_at')->nullable();
            $table->timestamp('departed_at')->nullable();
            $table->string('skip_reason', 200)->nullable();

            $table->timestamps();

            // Append-only ordering, enforced by the database rather than a
            // service's discipline. §7: nothing reorders a circuit.
            $table->unique(['trip_id', 'sequence']);
        });

        Schema::table('trips', function (Blueprint $table) {
            // §4: surfaced on the trip record and as a note on the invoice —
            // a note, not a charge. Counted at insert, never recomputed.
            $table->unsignedSmallInteger('unplanned_stop_count')->default(0)->after('distance_variance_flagged');
        });

        Schema::table('trip_events', function (Blueprint $table) {
            // §2: the timeline row for an arrival names its stop. Nullable —
            // every event before this feature, and every plain pause after
            // it, has none. nullOnDelete rather than cascade: the timeline
            // is append-only evidence and must outlive anything beside it.
            $table->foreignId('stop_id')->nullable()->after('user_id')
                ->constrained('trip_stops')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('trip_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('stop_id');
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('unplanned_stop_count');
        });

        Schema::dropIfExists('trip_stops');
    }
};
