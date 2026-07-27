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
}
