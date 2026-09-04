<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a fleet is on (ADR-0058 §1).
 *
 * ## Why this lands with `K2` and not with `K7`
 *
 * `K7` builds plans as a *feature* — limits, periods, prices, Kangaru's
 * invoice to a fleet. This migration builds the *invariant*, and it has to
 * exist before the rows do.
 *
 * `K2` is the package that first makes a second fleet creatable. Every fleet
 * created before a plans table exists is a fleet with no plan, and a nullable
 * `plan_id` meaning "free" is exactly the inference ADR-0055 §4 refused for
 * access levels — it fails silently, in the direction of giving something
 * away. ADR-0058's Consequences say it plainly: *"a window where fleets exist
 * with `plan_id` null is not"* acceptable.
 *
 * So: the table, one row, and a non-null column. No price, no period, no
 * enforcement — those are `K7`'s and nothing here presumes their shape.
 *
 * ## Free is a row, not an absence
 *
 * `is_default` marks the plan a fleet gets when none is named. ADR-0058 §1
 * requires creation to **fail** when no plan is flagged default rather than
 * fall back to free or to unlimited, so the flag is the seeded default's
 * only claim to being special — nothing keys on the id or the name.
 *
 * Shanitah is not put on Free. It gets its own row, per ADR-0058 §3: the
 * founding fleet's terms are legible in the data rather than expressed as
 * `if ($operator->id === 1)` somewhere in a billing path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('description')->nullable();

            // Exactly one row carries this. Not enforced by a unique index:
            // MySQL treats every `false` as distinct only for nulls, so a
            // partial index is not available, and `K7` owns the rule when it
            // owns the editing. Today the only writer is this migration.
            $table->boolean('is_default')->default(false);

            $table->timestamps();
        });

        $now = now();

        DB::table('plans')->insert([
            [
                'slug' => 'free',
                'name' => 'Free',
                'description' => 'Every fleet starts here. No charge, and the plan a fleet is given when none is named.',
                'is_default' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'slug' => 'founding-fleet',
                'name' => 'Founding fleet',
                'description' => "Shanitah's terms, negotiated. Held on the row so no billing path has to know an id (ADR-0058 §3).",
                'is_default' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        $founding = DB::table('plans')->where('slug', 'founding-fleet')->value('id');

        Schema::table('operators', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable()->after('status')->constrained()->restrictOnDelete();
        });

        // The only fleet that exists is Shanitah (ADR-0055 §1), and it is the
        // founding fleet by definition rather than by id.
        DB::table('operators')->update(['plan_id' => $founding]);

        Schema::table('operators', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('operators', function (Blueprint $table) {
            $table->dropForeign(['plan_id']);
            $table->dropColumn('plan_id');
        });

        Schema::dropIfExists('plans');
    }
};
