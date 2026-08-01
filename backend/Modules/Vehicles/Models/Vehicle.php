<?php

namespace Modules\Vehicles\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use Database\Factories\VehicleFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A fleet vehicle owned by a tenant. Minimal Phase-1 slice: category and
 * status are validated strings, not reference tables (vehicle categories,
 * branches, depots, maintenance and documents are deferred — see
 * Modules/Vehicles/README.md).
 *
 * @property int $id
 * @property int $tenant_id
 * @property string $registration_number
 * @property string $category
 * @property string $status
 */
class Vehicle extends Model
{
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /**
     * The Phase-1 vehicle categories. Not a reference table yet (see the
     * class docblock), but no longer a string literal repeated per call
     * site: Modules/Billing prices per category, so a category that exists
     * in one list and not another would be a vehicle nobody can invoice.
     *
     * @var array<int, string>
     */
    public const CATEGORIES = ['sedan', 'suv', 'van', 'minibus', 'bus', 'pickup', 'truck'];

    /**
     * Explicit, because Laravel's default factory resolver only guesses
     * correctly for models under App\Models — from Modules\ it would look
     * for Database\Factories\Modules\Vehicles\Models\VehicleFactory. Same
     * "explicit over convention across Modules\" stance as the policy
     * registrations in AppServiceProvider.
     */
    protected static function newFactory(): Factory
    {
        return VehicleFactory::new();
    }

    protected $fillable = [
        'tenant_id',
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

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
