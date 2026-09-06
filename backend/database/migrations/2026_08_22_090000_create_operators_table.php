<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fleet companies — and Shanitah becoming a row for the first time (ADR-0055).
 *
 * ## Shanitah has only ever existed as `NULL`
 *
 * `User::isPlatformLevel()` is literally `tenant_id === null`; five tables use
 * a null client to mean "the platform's"; `PlatformStaff` finds Shanitah's own
 * employees with `whereNull('tenant_id')`. There is no Shanitah row anywhere in
 * this schema and never has been. So this migration is not "add another
 * company" — it is giving the operator an identity for the first time, which is
 * what every later backfill points at.
 *
 * ## Why the insert is here and not in a seeder
 *
 * `php artisan migrate` runs without seeders on every deployed environment, and
 * the very next migration backfills `operator_id = 1` on six tables. A seeded
 * Shanitah would make that backfill fail on a foreign key in production while
 * passing locally, where somebody had run `db:seed` at some point. The row is
 * part of the schema change, so it ships with the schema change.
 *
 * The id is stated rather than left to auto-increment for the same reason:
 * every backfill in this pass names `1`, and "the first row happens to be 1" is
 * an assumption, not a guarantee, on a table somebody may later re-create.
 *
 * ## Deliberately shaped like `tenants`
 *
 * Same four columns, same names. The two tables are the two axes of ADR-0055
 * and they are peers — one is not a richer version of the other. A fleet's
 * business profile, if it ever needs one, is a `companies`-shaped table beside
 * this, exactly as ADR-0001 split identity from profile for a client.
 *
 * **F0 ships no way to create a second operator** — no endpoint, no screen, no
 * seeder. That is not an omission. Between F0 and F2 the operational tables
 * carry `operator_id` but nothing filters on it, so a second fleet's dispatcher
 * would read Shanitah's trips. The absence of a creation path is the rail that
 * holds until F2 closes that gap.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operators', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('status')->default('active');
            $table->timestamps();
        });

        DB::table('operators')->insert([
            'id' => 1,
            'name' => 'Shanitah General Enterprises Ltd',
            'slug' => 'shanitah',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('operators');
    }
};
