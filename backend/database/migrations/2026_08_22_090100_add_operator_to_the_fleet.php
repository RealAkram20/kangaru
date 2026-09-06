<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which fleet ran it (ADR-0055).
 *
 * ## Why six tables and not three
 *
 * `docs/fleet-model-plan.md` puts `operator_id` on users, drivers and vehicles
 * in F0, and on trips, bookings and invoices in F2. The column and the backfill
 * for all six land here, in F0; only the *scope wiring* waits for F2.
 *
 * The plan's own deadline argument applies unevenly and this corrects it: a
 * backfill is trivial only while every row genuinely is Shanitah's. That is
 * true today of 90 trips, 76 bookings and 48 invoices, and stops being true the
 * moment a second fleet has history — at which point "which fleet ran trip 41"
 * is a question nobody can answer. An unread column costs nothing now; the same
 * column added later is archaeology.
 *
 * **The intermediate state this creates, named so nobody discovers it:**
 * between F0 and F2 these columns exist and nothing filters on them, so a
 * *second* fleet's dispatcher would read Shanitah's trips. No second operator
 * may be created until F2 is done, and F0 deliberately ships no way to create
 * one.
 *
 * ## Nullability says something different on each table
 *
 * - **drivers, vehicles — NOT NULL.** A driver drives for a fleet and a vehicle
 *   belongs to one; there is no fleetless instance of either. These two are
 *   the tables F0 actually wires, so the constraint lands with the code that
 *   satisfies it.
 * - **trips, bookings — NULL means "Kangaru's, unclaimed".** A walk-in that no
 *   driver has accepted yet belongs to Kangaru and to no fleet (ADR-0055 §7).
 *   Every row that exists today is Shanitah's and is backfilled; the null is
 *   for rows F3 will create.
 * - **invoices — nullable here, tightened in F2.** An invoice is always issued
 *   by a fleet, so NOT NULL is the eventual truth. It is not imposed now
 *   because nothing in F0 teaches `InvoiceService` to set the column, and a
 *   constraint with no writer behind it turns a green suite red for a rule
 *   nobody is yet in a position to keep. The column and the backfill are what
 *   F0 is here for; the constraint belongs with its writer.
 * - **users — NULL means the account is not a fleet's.** A client's
 *   administrator and a Kangaru employee both have none, and which of the two
 *   is which is `access_level`'s job, not this column's. Backfilled in the next
 *   migration, because the two values are one invariant and must be set
 *   together.
 *
 * ## `restrictOnDelete`, not cascade and not null
 *
 * Deleting a fleet must fail while it has anything, rather than taking its
 * drivers and its clients' trip history with it. `users.tenant_id` uses
 * `nullOnDelete` for the mirror case, and that answer is wrong here: a user
 * with `access_level = 'fleet'` and a null `operator_id` violates the CHECK
 * constraint the next migration adds, so a cascade-to-null would leave the
 * table in a state the schema forbids. A fleet that stops trading is
 * deactivated through `operators.status`; it is not deleted.
 *
 * ## Order, which the last fleet migration learned the hard way
 *
 * Add nullable, backfill, tighten to NOT NULL, then add the foreign key. Adding
 * a NOT NULL foreign key to a populated table in one step fails on the rows
 * that already exist, and `2026_08_02_160000_move_fleet_to_the_platform` records
 * the mirror lesson for the reverse direction — an index a foreign key depends
 * on cannot be dropped first. `down()` reverses this sequence exactly, and CI
 * runs it.
 */
return new class extends Migration
{
    /** Tables whose every row must name a fleet, and whose writers F0 teaches. */
    private const REQUIRED = ['drivers', 'vehicles'];

    /**
     * Nullable here. On `trips` and `bookings` a null is a real state —
     * Kangaru's, unclaimed. On `invoices` it is temporary, and F2 tightens it
     * alongside the service that fills it in.
     */
    private const OPTIONAL = ['trips', 'bookings', 'invoices'];

    public function up(): void
    {
        // `drivers` and `vehicles` lost `tenant_id` in ADR-0005, so there is no
        // tenant column to sit after on those two.
        $after = [
            'drivers' => 'id',
            'vehicles' => 'id',
            'invoices' => 'tenant_id',
            'trips' => 'tenant_id',
            'bookings' => 'tenant_id',
        ];

        foreach ([...self::REQUIRED, ...self::OPTIONAL] as $table) {
            Schema::table($table, function (Blueprint $blueprint) use ($after, $table) {
                $blueprint->unsignedBigInteger('operator_id')->nullable()->after($after[$table]);
            });

            // Every row that exists is Shanitah's. This is the whole reason F0
            // has a deadline.
            DB::table($table)->update(['operator_id' => 1]);
        }

        foreach (self::REQUIRED as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('operator_id')->nullable(false)->change();
            });
        }

        foreach ([...self::REQUIRED, ...self::OPTIONAL] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
            });
        }

        // Not backfilled here — see the class docblock.
        Schema::table('users', function (Blueprint $blueprint) {
            $blueprint->unsignedBigInteger('operator_id')->nullable()->after('tenant_id');
            $blueprint->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        foreach (['users', ...self::REQUIRED, ...self::OPTIONAL] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['operator_id']);
                $blueprint->dropColumn('operator_id');
            });
        }
    }
};
