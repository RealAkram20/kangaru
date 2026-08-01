<?php

namespace App\Support\Money;

use Brick\Money\Money;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * Casts a minor-unit integer column to and from Brick\Money\Money.
 *
 * This is what makes AGENTS.md's "no raw integer math on money outside the
 * value object" rule enforceable rather than aspirational: a model attribute
 * declared with this cast cannot be added to another with `+` — it is a
 * Money, and PHP will refuse.
 *
 * The database column stays an integer. Nothing here changes the storage
 * contract; it changes what PHP hands you when you read it.
 *
 * The `set` half is declared as `mixed` rather than `Money|int|null`: the
 * interface passes whatever a caller assigned, and PHP does not enforce a
 * generic at runtime. Narrowing it here would make the guard below provably
 * unreachable to static analysis while remaining very much reachable in
 * production, which is the wrong way round.
 *
 * @implements CastsAttributes<Money, mixed>
 */
class MoneyMinorCast implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?Money
    {
        if ($value === null) {
            return null;
        }

        return Shillings::ofMinor((int) $value);
    }

    /**
     * Accepts either a Money or a plain int, so factories, seeders and
     * `create([...])` calls stay readable. Reads always come back as Money
     * regardless of which was written.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?int
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof Money) {
            return Shillings::toMinor($value);
        }

        if (is_int($value)) {
            return $value;
        }

        throw new \InvalidArgumentException(
            sprintf('%s must be set to a Brick\\Money\\Money or an integer minor amount, %s given.', $key, get_debug_type($value))
        );
    }
}
