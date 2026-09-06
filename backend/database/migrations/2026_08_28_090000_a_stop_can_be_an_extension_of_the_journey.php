<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A passenger who travels past the agreed drop-off — the extension.
 *
 * ## Why this lands in `trip_stops` rather than a table of its own
 *
 * Because the owner asked for it there, having been shown the alternative:
 * one place for "somewhere this trip went" is easier to read on a screen and
 * in a report than two. The cost is stated plainly here and in ADR-0045,
 * which this migration's sibling commit amends: **`trip_stops` is no longer
 * entirely unbilled.** §4's "recorded and shown, never billed and never
 * hidden" was true of every row until now and remains true of every row
 * whose `kind` is `stop`.
 *
 * ## Why `kind` is a new column and not a fifth `source`
 *
 * `source` answers *who* — planned, driver, dispatch, client — and an
 * extension can come from three of those four. Folding "extension" into it
 * would have made the two questions share one column and lost the answer to
 * the first: an extension a dispatcher added and one a passenger asked for
 * are different acts, and only one of them needs the driver's consent.
 *
 * It also keeps `unplanned_stop_count` honest without touching it.
 * `TripStopService` increments that counter for `ADDED_BY_DRIVER`, and §4 is
 * explicit that it is "a note, not a charge". A billed extension must never
 * land in a counter that means the opposite, and with `kind` separate it
 * cannot: the service increments on source *and* `kind === STOP`.
 *
 * ## The three columns
 *
 * - `kind` — `stop` (everything that exists today) or `extension`.
 * - `added_by_user_id` — who asked for it. `source` records the role; this
 *   records the person, because an extension changes what is owed and
 *   "which passenger asked" is the first question the desk gets.
 * - `accepted_at` — when the driver agreed. Null on a `proposed` row and on
 *   every ordinary stop; see `TripStopStatus::PROPOSED`.
 *
 * Nothing backfills. Every existing row is a `stop`, added by nobody in
 * particular, accepted at no time — which is exactly what those rows are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trip_stops', function (Blueprint $table) {
            // stop | extension. Defaulted so every row already in the table
            // means what it has always meant, and so an insert that predates
            // this feature cannot land as an accidental extension.
            $table->string('kind', 16)->default('stop')->after('longitude');

            // nullOnDelete, not cascade: a stop is evidence (ADR-0045 §1) and
            // must outlive the account of whoever asked for it. The row keeps
            // its label, its pins and its money; it loses only the name.
            $table->foreignId('added_by_user_id')->nullable()->after('source')
                ->constrained('users')->nullOnDelete();

            // The driver's consent, stamped. A `proposed` extension is not
            // part of the journey and is not routed through by
            // `RouteReference` until this is set.
            $table->timestamp('accepted_at')->nullable()->after('departed_at');

            // The read that matters on every distance resolution and every
            // in-progress screen: this trip's extensions, in run order.
            // `trip_id` alone is already indexed by the foreign key, but the
            // reference route filters on kind before ordering.
            $table->index(['trip_id', 'kind']);
        });

        Schema::table('trips', function (Blueprint $table) {
            /*
             * When the vehicle reached the destination the trip was agreed
             * for — the "before" half of the owner's ask.
             *
             * **Nothing recorded this until now, because nothing needed to.**
             * Arriving at the drop-off *was* the end of the trip, so the
             * event and the completion were one act. An extension separates
             * them: the passenger is set down where they asked, and then goes
             * somewhere else, and the trip runs on.
             *
             * It is a timestamp on the trip rather than a new `TripStatus`
             * because the state machine's graph is shared by every kind of
             * work this platform carries, and a state that only ever appears
             * on an extended walk-in would have to be legislated for on all
             * of them. This is a fact about one trip, not a new place in the
             * lifecycle.
             *
             * Two things read it, and they are the reason it exists:
             *
             * - `TripRouteController` — the driver's map routes to the agreed
             *   drop-off until this is set, and to the next accepted
             *   extension afterwards. Without it a walk-in that gained an
             *   extension would navigate straight past the passenger's
             *   original destination, because an extension is a `pending`
             *   stop and that endpoint routes to the first one it finds.
             * - completion — a trip with accepted extensions still to run is
             *   not finished, and this is what distinguishes "at the drop-off
             *   with more to do" from "not there yet".
             */
            $table->timestamp('dropoff_reached_at')->nullable()->after('unplanned_stop_count');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('dropoff_reached_at');
        });

        Schema::table('trip_stops', function (Blueprint $table) {
            $table->dropIndex(['trip_id', 'kind']);
            $table->dropConstrainedForeignId('added_by_user_id');
            $table->dropColumn(['kind', 'accepted_at']);
        });
    }
};
