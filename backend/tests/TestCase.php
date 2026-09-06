<?php

namespace Tests;

use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Roles are data now (ADR-0004), and a user's permissions are resolved
     * through the `roles` row matching their slug. `RefreshDatabase` gives
     * every test an empty database, so without this every user in the suite
     * would hold no permissions and every assertion would be a 403 — a
     * suite that fails for a reason unrelated to what it is testing.
     *
     * Only the roles are seeded, not `DatabaseSeeder`: tests build their own
     * tenants and users, and inheriting demo companies and bookings would
     * make counts fragile.
     */
    protected bool $seed = true;

    protected string $seeder = RoleSeeder::class;

    /**
     * `operators` is schema, not fixture data (ADR-0055).
     *
     * Shanitah is row 1 and is inserted by the migration that creates the
     * table rather than by a seeder, because six backfills name that id and
     * `php artisan migrate` runs without seeders in production. That decision
     * has a consequence here: the `Concurrency` suite uses `DatabaseTruncation`
     * — it spawns real OS processes that must see committed rows, so it cannot
     * roll back a transaction — and truncation empties every table it is not
     * told to leave alone. Shanitah went with it, and seven race tests failed
     * on the `vehicles.operator_id` foreign key rather than on anything they
     * were written to prove.
     *
     * Exempting the table is the fix that matches the decision, rather than
     * re-seeding a row the schema already guarantees. `RefreshDatabase` ignores
     * this property, so the `Feature` suite is unaffected — it re-runs the
     * migrations, and the migration is what puts Shanitah there.
     *
     * @var array<int, string>
     */
    protected array $exceptTables = ['operators'];
}
