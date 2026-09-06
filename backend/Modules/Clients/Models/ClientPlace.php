<?php

namespace Modules\Clients\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Database\Factories\ClientPlaceFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A location the client has pinned — an ATM, a branch, the head office
 * (ADR-0045 §1).
 *
 * Both coordinates are non-nullable at the database level, so there is no
 * "partially located" state for a screen to handle and no `?? 0` for a
 * reader to reach for. `mobile/src/trips/places.ts` records where that
 * fallback lands when somebody does: 0°N 0°E, in the Atlantic off Ghana,
 * which is exactly where ADR-0020 saw a latitude/longitude swap put a
 * Kampala vehicle for real.
 *
 * Audited, because a moved pin changes where a driver is sent and a renamed
 * place changes what a report groups by — both are things the client may
 * later need to account for to their own auditors.
 *
 * @property int $id
 * @property int $tenant_id
 * @property string $name
 * @property string|null $address
 * @property float $latitude
 * @property float $longitude
 * @property int|null $arrival_radius_m
 * @property string|null $notes
 * @property bool $is_active
 */
class ClientPlace extends Model
{
    /** @use HasFactory<ClientPlaceFactory> */
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /**
     * @see Company::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return ClientPlaceFactory::new();
    }

    protected $fillable = [
        'tenant_id',
        'name',
        'address',
        'latitude',
        'longitude',
        'arrival_radius_m',
        'notes',
        'is_active',
        'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            // Float, not decimal:7 — these are read straight into a map's
            // coordinate pair and a numeric string there is a silent
            // `NaN` on the JavaScript side. `trips.distance_km` casts to
            // decimal because it is money-adjacent and must not drift;
            // a pin is not.
            'latitude' => 'float',
            'longitude' => 'float',
            'arrival_radius_m' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    /**
     * Every position this place holds in every route.
     *
     * Read by the delete path: a place a route visits is not deletable, and
     * the foreign key would refuse it anyway. Asking here lets the refusal
     * carry a sentence naming the routes rather than a constraint violation.
     *
     * @return HasMany<ClientRouteStop, $this>
     */
    public function routeStops(): HasMany
    {
        return $this->hasMany(ClientRouteStop::class);
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
