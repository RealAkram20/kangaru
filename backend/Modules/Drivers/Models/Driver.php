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
use Modules\Vehicles\Models\Vehicle;

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
        // The vehicle this driver actually drives — theirs, in most cases,
        // and inseparably so for a boda rider. `driver_presence.vehicle_id`
        // is still the per-shift answer and wins when set; this is what a
        // driver falls back to, and what makes them offerable at all.
        'vehicle_id',
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

    /**
     * The vehicle they drive.
     *
     * Nullable, and that is not an edge case: a corporate driver takes
     * whatever the depot hands them that morning, and
     * `driver_presence.vehicle_id` is the per-shift answer for them. This is
     * the durable one — the driver's own vehicle, which for a boda rider is
     * not separable from the driver at all.
     *
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
