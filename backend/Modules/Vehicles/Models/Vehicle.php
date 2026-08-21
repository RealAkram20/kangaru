<?php

namespace Modules\Vehicles\Models;

use App\Concerns\Auditable;
use Database\Factories\VehicleFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Fleet\Models\VehicleAllocation;

/**
 * A fleet vehicle. Owned and operated by the platform, not by a client
 * (ADR-0005) — a corporate account is a client and owns no vehicle. It may
 * be *allocated* to one for a period, which is what Centenary Bank's letter
 * means by "vehicles supplied to the Bank"; that lives on
 * `vehicle_allocations`, not here.
 *
 * Deliberately NOT BelongsToTenant. `status` is still a validated string;
 * **`category` is no longer** — ADR-0050 made it a reference table,
 * `vehicle_categories`. The column stays a plain string with no foreign key
 * on purpose, so that the categories table can be renamed and reordered
 * without a rate card rate or an invoice line re-rendering through it.
 * Branches, depots, maintenance and documents remain deferred — see
 * Modules/Vehicles/README.md.
 *
 * @property int $id
 * @property string $registration_number
 * @property string $category
 * @property string $status
 */
class Vehicle extends Model
{
    use Auditable, HasFactory, SoftDeletes;

    /**
     * **No longer the validation source — see ADR-0050.** The categories a
     * vehicle may be given now live in the `vehicle_categories` table, and
     * `Modules\Vehicles\Rules\ActiveVehicleCategory` is the one rule that
     * reads it. Adding a category is an afternoon in the console, not a
     * deploy.
     *
     * This constant is kept, and has two remaining jobs:
     *
     * 1. **The migration seeds from it.** `create_vehicle_categories_table`
     *    reads this array so the nine keys land without a hand-typed tenth
     *    copy of the very list the table exists to stop copying.
     * 2. **`RideVehicleClass` points at these names.** Its class-to-category
     *    mapping is a recorded product decision naming `sedan`, `suv`,
     *    `van` and `boda`; deleting the constant would strand it.
     *
     * Do not add a case here expecting it to become choosable. It will not.
     * Add a row through the console, or, if it must exist from a fresh
     * database, add it here **and** in a migration.
     *
     * The history below is kept because it is the argument for ADR-0050.
     *
     * **`boda` and `tricycle` were missing, and the failure this docblock
     * predicted had already happened.** The walk-in tariff priced both, a
     * vehicle in the fleet was already recorded as a `boda`, and
     * `DriverAppSeeder` writes them — all by inserting rows directly, which
     * skips the validation that would have refused them. The visible symptom
     * was that a new version of the public tariff could not be saved through
     * the API at all: `StoreRateCardVersionRequest` validates against this
     * list, so it rejected two of the six categories the tariff already
     * priced.
     *
     * Ordered smallest first, which is how a chooser should read. Nothing
     * depends on the order; the lists are compared by content.
     *
     * **It then happened a second time, which is what ended the argument.**
     * `DriverFormDialog` shipped its own seven-item copy that omitted `boda`
     * and `tricycle` — on the form built precisely so a rider arriving on
     * their own boda could be onboarded. Two days, two mirrors, one drift.
     * Both are now gone: the web app reads the table and falls back to
     * `VEHICLE_CATEGORIES` in `frontend/src/lib/billing.ts` only when the
     * request fails.
     *
     * The self-drive subset in `StorePublicOrderRequest` is deliberately
     * narrower and is not this list — nobody self-drives a boda.
     *
     * @var array<int, string>
     */
    public const CATEGORIES = [
        'boda',
        'tricycle',
        'sedan',
        'suv',
        'van',
        'minibus',
        'bus',
        'pickup',
        'truck',
    ];

    /**
     * Explicit, because Laravel's default factory resolver only guesses
     * correctly for models under App\Models — from Modules\ it would look
     * for Database\Factories\Modules\Vehicles\Models\VehicleFactory. Same
     * "explicit over convention across Modules\" stance as the policy
     * registrations in AppServiceProvider.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return VehicleFactory::new();
    }

    protected $fillable = [
        'registration_number',
        'make',
        'model',
        'year',
        'category',
        'seating_capacity',
        'color',
        'vin',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'year' => 'integer',
            'seating_capacity' => 'integer',
        ];
    }

    /**
     * Periods this vehicle is contracted to a corporate account.
     *
     * @return HasMany<VehicleAllocation, $this>
     */
    public function allocations(): HasMany
    {
        return $this->hasMany(VehicleAllocation::class);
    }
}
