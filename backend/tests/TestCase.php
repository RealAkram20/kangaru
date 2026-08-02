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
}
