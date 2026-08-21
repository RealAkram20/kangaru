<?php

namespace Modules\Vehicles\Models;

use App\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

/**
 * The fleet's vocabulary of vehicle categories (ADR-0050).
 *
 * ## What this table is, and what it is not
 *
 * It is the list of keys that **may be chosen next**, with what each one is
 * called. It is **not** a parent of the rows that already carry a key:
 * `vehicles.category`, `rate_card_rates.vehicle_category` and
 * `invoice_lines.vehicle_category` remain plain strings with no foreign key,
 * deliberately, so that an issued invoice reproduces from stored data alone
 * and does not re-render through whatever this table says today.
 *
 * That is the whole reason `key` is immutable. Rename `suv` here and every
 * invoice ever raised for an SUV holds a string naming nothing — silently,
 * with no error anywhere, visible only as a document that no longer
 * reconciles. `UpdateVehicleCategoryRequest` does not accept the field, so
 * there is no path to it.
 *
 * Not `BelongsToTenant`, matching `Vehicle` for ADR-0005's reason: the fleet
 * is the platform's, and a client does not get their own idea of what a
 * minibus is.
 *
 * @property int $id
 * @property string $key
 * @property string $name
 * @property string|null $description
 * @property bool $active
 * @property int $position
 */
class VehicleCategory extends Model
{
    use Auditable;

    protected $fillable = [
        'key',
        'name',
        'description',
        'active',
        'position',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'position' => 'integer',
        ];
    }

    /**
     * Reading order: the office's chosen order, then name as the tiebreak so
     * two categories at the same position do not swap places between two
     * requests. An unstable list is a list where somebody clicks the wrong
     * row.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('position')->orderBy('name');
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('active', true);
    }

    /**
     * The keys a new vehicle or a new rate card version may choose.
     *
     * @return Collection<int, string>
     */
    public static function activeKeys(): Collection
    {
        return self::query()->active()->pluck('key');
    }

    /**
     * The next free display position, so a newly created category lands at
     * the end of the list rather than silently tying with an existing one.
     */
    public static function nextPosition(): int
    {
        return (int) self::query()->max('position') + 1;
    }
}
