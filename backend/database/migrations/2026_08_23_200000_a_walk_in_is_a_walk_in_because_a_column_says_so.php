<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `channel` on bookings and trips (ADR-0055 §2, ADR-0063 §5).
 *
 * ## The inference this replaces, and why it had to go
 *
 * *"A walk-in is a booking with no client"* is true today. ADR-0055 §2 asked
 * for this column anyway, and named the reason: the inference *"would quietly
 * stop being true the first time a client-less booking exists for some other
 * reason — and it would stop being true silently, in the one predicate that
 * decides what head office reads."*
 *
 * ADR-0063 adds a second load: the same predicate now decides **which fares
 * get split three ways**. A mis-channelled trip is no longer a display bug; it
 * is money reaching the wrong parties, and it would do so without anybody
 * seeing an error.
 *
 * ## This migration is the last moment the inference is known to be true
 *
 * That is the whole reason it backfills from `tenant_id IS NULL` rather than
 * asking somebody. Today the two agree exactly; every day after today they
 * might not, and there would be no way back to the truth. Run now, recorded
 * here, and never inferred again.
 *
 * On this database at the time of writing: **34 of 93 trips** carry no client.
 *
 * ## `corporate` is the default, and that is the safe direction
 *
 * A row whose channel nobody set is treated as a client's work, which means it
 * is **not** swept into Kangaru's commission. Getting that wrong in the other
 * direction would have Kangaru billing commission on a bank's contracted trip.
 * The failure that costs money is the one to design against.
 */
return new class extends Migration
{
    private const CORPORATE = 'corporate';

    private const WALK_IN = 'walk_in';

    public function up(): void
    {
        foreach (['bookings', 'trips'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->string('channel', 16)->default(self::CORPORATE)->after('tenant_id');
            });

            // The backfill, and the last moment the inference is trustworthy.
            DB::table($table)->whereNull('tenant_id')->update(['channel' => self::WALK_IN]);

            Schema::table($table, function (Blueprint $blueprint) {
                // Kangaru's own reads filter on this and on nothing else
                // (ADR-0055 §2's narrow exception), and the commission run
                // sweeps it per period.
                $blueprint->index(['channel', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        foreach (['bookings', 'trips'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                // The **columns**, not a name. `dropIndex(['a_name'])` treats
                // the array as columns to derive a name from, so passing the
                // finished name yields `trips_trips_channel_..._index_index`
                // and the drop misses. Giving it the columns lets Laravel
                // derive exactly what `up()` created.
                $blueprint->dropIndex(['channel', 'created_at']);
                $blueprint->dropColumn('channel');
            });
        }
    }
};
