<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
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
 * @property int $tenant_id
 * @property string $name
 * @property RateCardStatus $status
 * @property bool $is_default
 */
class RateCard extends Model
{
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /** @see Vehicle::newFactory() for why this is explicit. */
    protected static function newFactory(): Factory
    {
        return RateCardFactory::new();
    }

    protected $fillable = [
        'tenant_id',
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

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** Newest first — the order a human reads a version history in. */
    public function versions(): HasMany
    {
        return $this->hasMany(RateCardVersion::class)->orderByDesc('version');
    }
}
