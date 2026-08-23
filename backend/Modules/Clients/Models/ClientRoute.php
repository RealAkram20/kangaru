<?php

namespace Modules\Clients\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Database\Factories\ClientRouteFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A circuit the client built — the *plan* half of ADR-0045 §1.
 *
 * This row is editable for its whole life, and that is why a trip raised
 * from it copies its stops instead of pointing at them. Nothing downstream
 * of a booking ever reads this model again; if it did, editing the Monday
 * ATM run would rewrite last month's evidence.
 *
 * @property int $id
 * @property int $tenant_id
 * @property string $name
 * @property string|null $reference
 * @property string|null $notes
 * @property bool $is_active
 */
class ClientRoute extends Model
{
    /** @use HasFactory<ClientRouteFactory> */
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /**
     * @see Company::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return ClientRouteFactory::new();
    }

    protected $fillable = [
        'tenant_id',
        'name',
        'reference',
        'notes',
        'is_active',
        'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    /**
     * The stops, in the order they are driven.
     *
     * **Ordered here rather than at every call site.** The sequence is the
     * entire meaning of this relation — a route whose stops arrive in
     * insertion order is a different circuit from the one the client drew,
     * and it would look correct in every test that did not assert on order.
     *
     * @return HasMany<ClientRouteStop, $this>
     */
    public function stops(): HasMany
    {
        return $this->hasMany(ClientRouteStop::class)->orderBy('sequence');
    }

    /**
     * The team who ride it (ADR-0045 §8).
     *
     * Not a permission. Nothing authorises off this relation — see the
     * `client_route_members` migration for why that distinction is worth
     * restating wherever the relation appears.
     *
     * @return BelongsToMany<User, $this>
     */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'client_route_members')
            ->withTimestamps();
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
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
