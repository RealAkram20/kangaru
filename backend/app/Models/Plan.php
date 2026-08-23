<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What a fleet pays to be on Kangaru (ADR-0058).
 *
 * A plan is **rows, not code**: limits, price and period live here so adding
 * a tier or grandfathering an operator is a data change, not a deploy. That
 * is deliberately the opposite instinct from `AccessLevel`, which is an enum
 * — and the distinction is worth stating, because the two look similar. An
 * access level is a security boundary and must be reviewable in a diff; a
 * price is a commercial term and will change without an engineer.
 *
 * `K2` created this table to hold the invariant that no fleet exists without
 * a plan. **The columns that make it a commercial object — price, period,
 * limits, entitlements — are `K7`'s**, along with every rule about them. Do
 * not add enforcement here without reading ADR-0058 §4 first: a limit blocks
 * adding, and never removes, disables or breaks what already exists.
 *
 * @property int $id
 * @property string $slug
 * @property string $name
 * @property string|null $description
 * @property bool $is_default
 */
class Plan extends Model
{
    protected $fillable = [
        'slug',
        'name',
        'description',
        'is_default',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
        ];
    }

    /**
     * The plan a fleet gets when none is named (ADR-0058 §1).
     *
     * Null is a real answer and callers must handle it: ADR-0058 requires
     * fleet creation to **fail** when nothing is flagged default, rather than
     * fall back to free or to unlimited. An unpriced fleet is a configuration
     * error, and it should say so at creation rather than at the first
     * billing run.
     */
    public static function default(): ?self
    {
        return self::query()->where('is_default', true)->first();
    }

    /** @return HasMany<Operator, $this> */
    public function operators(): HasMany
    {
        return $this->hasMany(Operator::class);
    }
}
