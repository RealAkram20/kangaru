<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Concerns\InheritsKangaruDefaults;
use App\Models\Tenant;
use Database\Factories\RateCardFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Vehicles\Models\Vehicle;

/**
 * A named pricing agreement with a corporate client. Carries no prices
 * itself — those live on RateCardVersion, which is immutable once used.
 *
 * Mutable on purpose: renaming a card, archiving it, or changing which one
 * is the tenant's default does not change a single number on any invoice
 * ever issued, because invoices reference a version, not a card.
 *
 * @property int $id
 * @property int|null $tenant_id Null on the platform's public tariff
 *                               (ADR-0026 §1), which belongs to no client.
 * @property string $name
 * @property RateCardStatus $status
 * @property bool $is_default
 */
class RateCard extends Model
{
    /** @use HasFactory<RateCardFactory> */
    use Auditable, BelongsToTenant, HasFactory, InheritsKangaruDefaults, SoftDeletes;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return RateCardFactory::new();
    }

    protected $fillable = [
        'tenant_id',
        // The fleet whose price this is. Null on the walk-in tariff, which
        // is Kangaru's: Kangaru owns the walk-in customer, so Kangaru sets
        // what the walk-in pays (ADR-0055 §5).
        'operator_id',
        'name',
        'description',
        'status',
        'is_default',
    ];

    protected function casts(): array
    {
        return [
            'status' => RateCardStatus::class,
            'is_default' => 'boolean',
        ];
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Newest first — the order a human reads a version history in.
     *
     * @return HasMany<RateCardVersion, $this>
     */
    public function versions(): HasMany
    {
        return $this->hasMany(RateCardVersion::class)->orderByDesc('version');
    }
}
