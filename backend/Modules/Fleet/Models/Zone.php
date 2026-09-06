<?php

namespace Modules\Fleet\Models;

use App\Concerns\Auditable;
use App\Concerns\InheritsKangaruDefaults;
use App\Models\Tenant;
use Database\Factories\ZoneFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Support\BoundaryRing;

/**
 * A geofence (ADR-0021).
 *
 * Deliberately **not** `BelongsToTenant`, despite carrying a nullable
 * `tenant_id`. The global scope would hide every platform zone — service
 * areas, towns — from a client, and those are precisely the ones that must
 * apply to their trips. Scoping is done explicitly in `ZoneResolver`, which
 * asks for "the platform's zones plus this client's" rather than "this
 * client's".
 *
 * @property ZoneKind $kind
 * @property array<int, array{lat: float, lng: float}> $boundary
 * @property int $priority
 * @property bool $active
 */
class Zone extends Model
{
    /** @use HasFactory<ZoneFactory> */
    use Auditable, HasFactory, InheritsKangaruDefaults, SoftDeletes;

    /**
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return ZoneFactory::new();
    }

    protected $fillable = ['tenant_id', 'operator_id', 'name', 'kind', 'boundary', 'priority', 'active', 'notes'];

    protected function casts(): array
    {
        return [
            'kind' => ZoneKind::class,
            'boundary' => 'array',
            'priority' => 'integer',
            'active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function ring(): BoundaryRing
    {
        return BoundaryRing::fromArray($this->boundary);
    }

    public function contains(float $lat, float $lng): bool
    {
        return $this->ring()->contains($lat, $lng);
    }

    /**
     * The platform's zones plus one client's — never another client's.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeVisibleTo(Builder $query, ?int $tenantId): Builder
    {
        return $query->where(function (Builder $q) use ($tenantId) {
            $q->whereNull('tenant_id');

            if ($tenantId !== null) {
                $q->orWhere('tenant_id', $tenantId);
            }
        });
    }
}
