<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\User;
use RuntimeException;

/**
 * Finds Shanitah's own employees for the demo seeders (ADR-0006).
 *
 * Platform staff belong to no tenant, so they are looked up by
 * `tenant_id IS NULL` rather than per-tenant. Written once here because both
 * demo seeders need them and the alternative is the same query in two
 * places — the copy-per-caller habit ADR-0006 exists to end.
 *
 * Deliberately throws rather than returning null. `DemoHistorySeeder` used
 * to `return` quietly when it could not find a user, which is the right
 * shape for an optional record and the wrong one for this: after the staff
 * move, a null here means every tenant's history seeds as nothing and
 * `migrate:fresh --seed` reports success over an empty demo.
 */
final class PlatformStaff
{
    public static function dispatcher(): User
    {
        return self::holding(UserRole::DISPATCHER);
    }

    public static function finance(): User
    {
        return self::holding(UserRole::FINANCE);
    }

    private static function holding(UserRole $role): User
    {
        $user = User::query()
            ->whereNull('tenant_id')
            ->where('role', $role->value)
            ->first();

        if ($user === null) {
            throw new RuntimeException(
                "No platform-level {$role->value} exists. DatabaseSeeder::seedPlatformStaff() seeds it; "
                .'the demo seeders cannot run without it.'
            );
        }

        return $user;
    }
}
