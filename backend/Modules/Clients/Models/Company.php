<?php

namespace Modules\Clients\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * The corporate client's business profile — one per Tenant in Phase 1.
 * First real exercise of BelongsToTenant/TenantScope (ADR-0001).
 *
 * @property int $id
 * @property int $tenant_id
 * @property string $legal_name
 * @property int $credit_limit_minor
 * @property string $status
 */
class Company extends Model
{
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    protected $fillable = [
        'tenant_id',
        'legal_name',
        'trading_name',
        'registration_number',
        'industry',
        'billing_email',
        'phone',
        'address_line1',
        'address_line2',
        'city',
        'country',
        'credit_limit_minor',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'credit_limit_minor' => 'integer',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
