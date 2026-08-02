<?php

namespace App\Casts;

use App\Enums\UserRole;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * `users.role` as a plain slug that still accepts a UserRole on write.
 *
 * Since ADR-0004 a role may be one the ten-case `UserRole` enum has never
 * heard of, so the column can no longer be cast to it — `UserRole::from()`
 * throws a ValueError the moment somebody holds a custom role, which is a
 * fatal error on *reading a user*, i.e. on every authenticated request they
 * make.
 *
 * Reading therefore gives a string. Writing still accepts `UserRole::X`,
 * because seeders, factories and a great many tests pass the enum and there
 * is no reason to churn them: the enum remains a convenient handle on the
 * ten seeded roles, it is simply no longer the whole set.
 *
 * @implements CastsAttributes<string, string|UserRole>
 */
class RoleSlug implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): string
    {
        return (string) $value;
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, string>
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        return [$key => $value instanceof UserRole ? $value->value : (string) $value];
    }
}
