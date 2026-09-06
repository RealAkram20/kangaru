<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A plan becomes a commercial object (ADR-0058, `K7`).
 *
 * `K2` created this table to hold one invariant — no fleet exists without a
 * plan — and left the columns that make it a *plan* rather than a label to
 * this package, which is where the rules about them are written.
 *
 * ## Null means unlimited, and that is a decision rather than a shortcut
 *
 * `driver_limit`, `vehicle_limit` and `staff_limit` are nullable, and a null
 * is **no ceiling** — not "unset", not "nought". Two reasons:
 *
 * - The alternative encoding is a magic large number, which is a ceiling
 *   somebody eventually hits, at a scale where hitting it is most expensive.
 * - Shanitah's *Founding fleet* plan has no limits at all (ADR-0058 §3), and a
 *   grandfathered operator whose unlimited-ness is spelled `999999` is one
 *   careless comparison away from being limited.
 *
 * `PlanAllowance` is the only thing that reads these, so the null case is
 * handled in exactly one place.
 *
 * ## Money, per AGENTS.md
 *
 * Minor units and an ISO 4217 code, never a float and never a bare number.
 * `price_minor` is nought on Free, which is a real price rather than an
 * absence — ADR-0058 §1 is explicit that Free is a plan, not the lack of one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->unsignedBigInteger('price_minor')->default(0)->after('description');
            $table->string('currency', 3)->default('UGX')->after('price_minor');

            // `none` rather than a nullable column: a plan that charges
            // nothing still has an answer to "how often", and it is "never".
            // A null here would make every billing-run query say
            // `whereNotNull('period')` and mean something subtly different.
            $table->string('period', 16)->default('none')->after('currency');

            $table->unsignedInteger('driver_limit')->nullable()->after('period');
            $table->unsignedInteger('vehicle_limit')->nullable()->after('driver_limit');
            $table->unsignedInteger('staff_limit')->nullable()->after('vehicle_limit');
        });

        // Free gets the limits ADR-0058 §1 names. Written here rather than in a
        // seeder because the row already exists on every environment that ran
        // `K2`, and a seeder would not reach it.
        DB::table('plans')->where('slug', 'free')->update([
            'price_minor' => 0,
            'currency' => 'UGX',
            'period' => 'none',
            'driver_limit' => 10,
            'vehicle_limit' => 10,
            'staff_limit' => 5,
        ]);

        // Shanitah's plan keeps its nulls: unlimited, by name, on the row.
        DB::table('plans')->where('slug', 'founding-fleet')->update([
            'price_minor' => 0,
            'currency' => 'UGX',
            'period' => 'none',
        ]);
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->dropColumn([
                'price_minor',
                'currency',
                'period',
                'driver_limit',
                'vehicle_limit',
                'staff_limit',
            ]);
        });
    }
};
