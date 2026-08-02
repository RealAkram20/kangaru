<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\Tenant;
use App\Models\User;
use Database\Factories\DriverFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A tenant's driver profile. Minimal Phase-1 slice: qualifications,
 * availability, performance and document uploads are deferred — see
 * Modules/Drivers/README.md.
 *
 * @property int $id
 * @property string $name
 * @property string $license_number
 * @property string $status
 */
class Driver extends Model
{
    use Auditable, HasFactory, SoftDeletes;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return DriverFactory::new();
    }

    protected $fillable = [
        'user_id',
        'name',
        'phone',
        'email',
        'license_number',
        'license_expiry',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'license_expiry' => 'date',
        ];
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
