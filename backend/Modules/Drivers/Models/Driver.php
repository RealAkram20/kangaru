<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToOperator;
use App\Models\User;
use Database\Factories\DriverFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Drivers\Contracts\HoldsDocuments;
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
 * @property string|null $referral_code Minted on first use — see ReferralService::codeFor().
 * @property string|null $photo_path Private-disk path; streamed, never linked (ADR-0041).
 * @property bool $owns_vehicle Whose vehicle `vehicle_id` names (ADR-0048 §7).
 */
class Driver extends Model implements HoldsDocuments
{
    use Auditable, BelongsToOperator, HasFactory, SoftDeletes;

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
        // The fleet this driver drives for (ADR-0055). Same reasoning as
        // `Vehicle::$fillable` — ADR-0005 was right that a client owns no
        // driver, and what changed is that the owner is now nameable.
        //
        // A driver may *also* contract with Kangaru directly to work walk-ins
        // (ADR-0055 §7). That is a separate record, not a second value here:
        // the fleet still employs them.
        'operator_id',
        'name',
        'phone',
        // The vehicle this driver actually drives — theirs, in most cases,
        // and inseparably so for a boda rider. `driver_presence.vehicle_id`
        // is still the per-shift answer and wins when set; this is what a
        // driver falls back to, and what makes them offerable at all.
        'vehicle_id',
        /**
         * Whether `vehicle_id` above is *theirs* (ADR-0048 §7).
         *
         * The column exists because `vehicle_id` cannot answer it. A boda
         * rider whose machine is their livelihood and a corporate driver
         * holding the keys to a depot Premio this week set the same column to
         * the same kind of value, and the two differ in every way an operator
         * cares about: who insures it, who repairs it, whether it leaves when
         * they do, and whether `vehicle_registration` and `vehicle_insurance`
         * are the driver's papers or the platform's.
         *
         * Not derived from `vehicle_id !== null` — that derivation answers
         * "has a vehicle", which the depot driver also answers `true` to.
         */
        'owns_vehicle',
        'email',
        'license_number',
        'license_expiry',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'license_expiry' => 'date',
            'owns_vehicle' => 'boolean',
        ];
    }

    /**
     * Where this driver's papers live (ADR-0033 §5, ADR-0048 §3).
     *
     * Unchanged from what `DriverDocumentStore` built by hand before the
     * contract existed, so every file already on disk is still found by it.
     */
    public function documentDirectory(): string
    {
        return sprintf('drivers/%d/documents', $this->getKey());
    }

    public function documentOwnerLabel(): string
    {
        return sprintf('driver %d', $this->getKey());
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
