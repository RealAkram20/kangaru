<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Settings and vehicle categories, and what a fleet may override (ADR-0055).
 *
 * ## A null fleet here means "Kangaru's default"
 *
 * ADR-0055 §5 gives Kangaru *"the default zones and vehicle categories fleets
 * inherit"*. So on these two tables a null `operator_id` is a default that
 * every fleet reads and only Kangaru edits, and a row with a fleet is that
 * fleet's override of it.
 *
 * **This is a decision about these two tables, not about the column.** On a
 * walk-in booking a null fleet will mean *Kangaru's, unclaimed*, and if "null
 * means everybody may read" escaped from here to there, every fleet would get
 * every walk-in customer's phone number and home address. The inheritance is an
 * explicit scope on named models (`InheritsKangaruDefaults`); it is never a
 * property of `operator_id` itself.
 *
 * ## Existing rows stay Kangaru's, which is what keeps behaviour identical
 *
 * Every setting and category on the platform today becomes a default that
 * Shanitah inherits, rather than a row Shanitah owns. Resolution prefers a
 * fleet's row and falls back to Kangaru's, so with no overrides in existence
 * every read returns exactly what it returned before this ran. A fleet that
 * later wants a different odometer rule writes its own row beside the default
 * instead of editing everyone's.
 *
 * ## The uniqueness trap, which is the real work here
 *
 * `settings` is `unique(group, key)` and `vehicle_categories` is `unique(key)`.
 * Simply adding `operator_id` to those keys **does not work**: MySQL and
 * MariaDB both treat NULLs in a unique index as distinct, so
 * `(NULL, 'dispatch', 'odometer')` inserts twice happily and the constraint
 * silently guarantees nothing — for the Kangaru rows, which are all of them
 * today. `create_rate_cards_table` already documents this trap in a comment;
 * this is the same trap with the nullable column on the other side.
 *
 * A virtual generated column collapses the null to a value a unique index can
 * see. `COALESCE(operator_id, 0)` is safe as a sentinel because `operators.id`
 * is an auto-increment starting at 1, so 0 is a value no fleet can ever hold.
 *
 * Probed against MariaDB 10.4 before being written: a second Kangaru default is
 * refused, and a fleet override alongside the default is accepted. CI runs
 * MySQL 8.4, which supports indexed virtual columns equally — but that half is
 * verified by CI, not here.
 */
return new class extends Migration
{
    /** table => the columns the fleet scope must be unique against. */
    private const KEYED_BY = [
        'settings' => ['`group`', '`key`'],
        'vehicle_categories' => ['`key`'],
    ];

    public function up(): void
    {
        foreach (array_keys(self::KEYED_BY) as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('operator_id')->nullable()->after('id');
                $blueprint->foreign('operator_id')->references('id')->on('operators')->restrictOnDelete();
            });
        }

        // The old keys go before the new ones can mean anything: while
        // `unique(group, key)` stands, a fleet cannot write an override at all.
        Schema::table('settings', function (Blueprint $blueprint) {
            $blueprint->dropUnique(['group', 'key']);
        });

        Schema::table('vehicle_categories', function (Blueprint $blueprint) {
            $blueprint->dropUnique(['key']);
        });

        foreach (self::KEYED_BY as $table => $columns) {
            DB::statement(
                "ALTER TABLE {$table} ADD COLUMN operator_scope BIGINT UNSIGNED "
                .'AS (COALESCE(operator_id, 0)) VIRTUAL'
            );

            DB::statement(
                "ALTER TABLE {$table} ADD UNIQUE {$table}_operator_scope_unique "
                .'('.implode(', ', ['operator_scope', ...$columns]).')'
            );
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::KEYED_BY) as $table) {
            DB::statement("ALTER TABLE {$table} DROP INDEX {$table}_operator_scope_unique");
            DB::statement("ALTER TABLE {$table} DROP COLUMN operator_scope");

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['operator_id']);
                $blueprint->dropColumn('operator_id');
            });
        }

        // Restoring these can fail where the fleet overrides this migration
        // made possible still exist — two rows collapse onto one key the
        // moment the fleet column is gone. That is correct: rolling back a
        // schema that permitted something is not a way to delete the rows
        // somebody created under it. CI rolls back an empty database, where
        // the question does not arise.
        Schema::table('settings', function (Blueprint $blueprint) {
            $blueprint->unique(['group', 'key']);
        });

        Schema::table('vehicle_categories', function (Blueprint $blueprint) {
            $blueprint->unique(['key']);
        });
    }
};
