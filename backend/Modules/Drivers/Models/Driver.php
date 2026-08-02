<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Database\Factories\DriverFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A driver profile. Employed and managed by the platform, not by a client
 * (ADR-0005) — a corporate account is a client and employs no driver.
 *
 * Deliberately NOT BelongsToTenant, and `license_number` is globally
 * unique, which is what a licence number is.
 *
 * Minimal Phase-1 slice: qualifications, availability, performance and
 * document uploads are deferred — see Modules/Drivers/README.md.
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

    /**
     * The account this driver signs in as, if they have one.
     *
     * There is deliberately no `tenant()` here. ADR-0005 dropped
     * `drivers.tenant_id` — a driver is the platform's, not a client's —
     * and the relation outlived the column for a while, which made
     * `$driver->tenant` a query against a column that no longer exists.
     * Nothing called it, so nothing failed; it is gone rather than left as
     * a trap.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
