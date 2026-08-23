<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Modules\Clients\Models\Company;

/**
 * The identity anchor for ADR-0001 multi-tenancy. Every tenant-owned table's
 * tenant_id foreign-keys to this. Kept deliberately lean — richer business
 * profile data (legal name, billing contact, etc.) lives on Modules\Clients\Models\Company.
 *
 * @property int $id
 * @property string $name
 * @property string $slug
 * @property string $status
 */
class Tenant extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'slug',
        'status',
    ];

    public function company(): HasOne
    {
        return $this->hasOne(Company::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    /**
     * The fleets serving this client, and on what terms (ADR-0055 §6).
     *
     * A client may contract more than one, which is the decision that made
     * `operator_id` and `tenant_id` two independent columns rather than a
     * hierarchy. This is the relation the fleet switcher reads.
     *
     * Every contract, including ended ones: a contract that has finished still
     * owns the trips and invoices raised under it, and dropping it from this
     * list would leave a year of the client's own history attributed to
     * nobody. Callers wanting only current ones ask `OperatorClient::serving()`.
     *
     * @return HasMany<OperatorClient, $this>
     */
    public function contracts(): HasMany
    {
        return $this->hasMany(OperatorClient::class);
    }
}
