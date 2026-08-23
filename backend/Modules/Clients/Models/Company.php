<?php

namespace Modules\Clients\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use Database\Factories\CompanyFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Vehicles\Models\Vehicle;

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

    /**
     * The client directory is Kangaru's to read, so head office may resolve a
     * company by id (ADR-0062 §2).
     *
     * This model and no other. `CompanyService::list()` already drops the
     * tenant scope for `kangaru` on the listing; without this the *URL* still
     * 404'd, so head office could see its directory and not open a single row
     * of it — and could therefore never correct a name it had typed itself.
     *
     * The operations stay unreachable, which is the point of doing this per
     * model rather than in the trait: a trip, a booking and an invoice belong
     * to the fleet serving the client, and head office reaches those by acting
     * as somebody there.
     */
    protected function headOfficeResolvesByRoute(): bool
    {
        return true;
    }

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return CompanyFactory::new();
    }

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

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
