<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A registration number identifies one client, platform-wide (ADR-0060 §1).
 *
 * ## The hazard this closes
 *
 * A fleet onboards its own corporate clients (`K6`), and a client may be
 * served by several fleets. So Shanitah signs Centenary Bank, and six months
 * later a second fleet signs the same bank — and without a match key each
 * creates its own row. The bank then has two logins, two trip histories that
 * no report reconciles, two sets of invoices, and two `tenant_id`s, which
 * means the isolation model is working perfectly and keeping the bank's data
 * from itself.
 *
 * **No merge afterwards is clean.** `tenant_id` is on trips, bookings,
 * invoices, routes, places and users; merging two clients means rewriting the
 * column the whole isolation model rests on, in production, across nine
 * tables.
 *
 * ## Unique when present, and still nullable
 *
 * The column stays `nullable()` and that is the decision, not an oversight.
 * ADR-0060 §1: *require it on next edit; do not invent one.* A backfill that
 * generated placeholder numbers would fill the identity key with values that
 * are unique and meaningless, which is worse than null — it would look like
 * every client had been identified.
 *
 * A `UNIQUE` index treats NULLs as distinct in both MySQL and MariaDB, so
 * existing rows keep their nulls and any number of future rows may too. What
 * cannot happen is two rows carrying the **same** number.
 *
 * **Required at onboarding is a request rule, not a column rule**, and it
 * lives in `K6`'s form request. The two halves are deliberately different:
 * the database says "never twice", the form says "always, from now on", and
 * neither can express the other's job without breaking the existing rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Fail loudly rather than let the index creation throw an SQLSTATE
        // nobody can read. The same stance `move_fleet_to_the_platform` took
        // for vehicle plates: a migration that cannot state which rows are in
        // the way is a migration somebody runs twice hoping.
        $duplicates = DB::table('companies')
            ->select('registration_number')
            ->whereNotNull('registration_number')
            ->groupBy('registration_number')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('registration_number');

        if ($duplicates->isNotEmpty()) {
            throw new RuntimeException(
                'Two or more companies already share a registration number, so it cannot become '
                .'the platform-wide identity of a client (ADR-0060). Reconcile these first: '
                .$duplicates->implode(', ')
            );
        }

        Schema::table('companies', function (Blueprint $table) {
            $table->unique('registration_number');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->dropUnique(['registration_number']);
        });
    }
};
