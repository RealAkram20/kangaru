<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A walk-in customer becomes a real account holder (ADR-0015): given and
 * family names as separate columns, plus an optional gender.
 *
 * `name` is replaced rather than kept alongside the split, because
 * AGENTS.md forbids storing the same information twice — two sources for
 * a person's name is two things to disagree. `Customer::name` is now an
 * accessor over the pair, so every existing reader (the dispatcher queue
 * through OrderRequestResource, notifications) keeps working unchanged.
 *
 * Split on the *first* space, not the last: "Nakato Grace Mary" is a
 * given name and two family names far more often than the reverse here.
 * Anyone the split gets wrong can correct it on their profile, which is
 * the only reason a guess is acceptable at all.
 *
 * Not a zero-downtime three-step (AGENTS.md) on purpose: `customers`
 * shipped days ago behind an unbuilt sign-up screen and holds no
 * production rows, so there is no reader to keep alive across the change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('first_name', 60)->after('id')->default('');
            $table->string('last_name', 60)->after('first_name')->default('');
            // Nullable and unconstrained by the database: the closed list
            // lives in CustomerGender, which the form request enforces.
            // Null means never asked; 'prefer_not_to_say' means asked and
            // declined, and the two must not collapse into each other.
            $table->string('gender', 20)->nullable()->after('last_name');
        });

        // Backfill before the source column goes away.
        foreach (DB::table('customers')->select('id', 'name')->get() as $customer) {
            $name = trim((string) $customer->name);
            $split = strpos($name, ' ');

            DB::table('customers')->where('id', $customer->id)->update([
                'first_name' => $split === false ? $name : substr($name, 0, $split),
                'last_name' => $split === false ? '' : trim(substr($name, $split + 1)),
            ]);
        }

        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('name');
        });

        // The defaults existed only so the backfill had somewhere to land;
        // a new row must state a name rather than inherit an empty one.
        Schema::table('customers', function (Blueprint $table) {
            $table->string('first_name', 60)->default(null)->change();
            $table->string('last_name', 60)->default(null)->change();
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('name', 120)->after('id')->default('');
        });

        foreach (DB::table('customers')->select('id', 'first_name', 'last_name')->get() as $customer) {
            DB::table('customers')->where('id', $customer->id)->update([
                'name' => trim($customer->first_name.' '.$customer->last_name),
            ]);
        }

        Schema::table('customers', function (Blueprint $table) {
            $table->string('name', 120)->default(null)->change();
            $table->dropColumn(['first_name', 'last_name', 'gender']);
        });
    }
};
