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
 * Deliberately NOT BelongsToTenant. Minimal Phase-1 slice: category and
 * status are validated strings, not reference tables (vehicle categories,
 * branches, depots, maintenance and documents are deferred — see
 * Modules/Vehicles/README.md).
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
     * The Phase-1 vehicle categories. Not a reference table yet (see the
     * class docblock), but no longer a string literal repeated per call
     * site: Modules/Billing prices per category, so a category that exists
     * in one list and not another would be a vehicle nobody can invoice.
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
     * Mirrored in `frontend/src/lib/billing.ts` and `docs/api/openapi.yaml`.
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
