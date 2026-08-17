<?php

namespace Modules\Fleet\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * One shift: on duty at `started_at`, off duty at `ended_at` (ADR-0038).
 *
 * ## Deliberately not `Auditable`
 *
 * Every other model in this module carries the trait, so its absence here is
 * a decision rather than an omission. `Auditable` writes an `audit_logs` row
 * on every create, update **and** delete — and `last_seen_at` on an open
 * session is updated once per heartbeat, per on-duty driver, all day.
 *
 * That is a row a minute per working driver, which is precisely the
 * per-heartbeat telemetry table ADR-0024 §2 refused, relocated into
 * `audit_logs` where nobody would think to look for it. The audit log exists
 * to record *decisions people made*; a timer firing is not one.
 *
 * The two facts that genuinely are decisions — a driver going on duty and
 * coming off — are recorded by this table itself, which is append-mostly and
 * is the audit trail for them.
 *
 * @property int $driver_id
 * @property int|null $vehicle_id
 * @property Carbon $started_at
 * @property Carbon|null $ended_at null while the shift is running
 * @property Carbon|null $last_seen_at the last heartbeat this shift received
 * @property string|null $ended_reason `driver` or `stale`
 */
class DriverDutySession extends Model
{
    /** The driver pressed the switch. */
    public const ENDED_BY_DRIVER = 'driver';

    /**
     * The sweep closed it, because no heartbeat arrived for longer than
     * `dispatch.presence_ttl_seconds`.
     *
     * Worth being able to point at: a driver disputing their online hours is
     * almost always disputing one of these, and "your phone stopped reporting
     * at 14:20" is an answerable claim where "the system says six hours" is
     * not.
     */
    public const ENDED_BY_STALENESS = 'stale';

    protected $fillable = [
        'driver_id',
        'vehicle_id',
        'started_at',
        'ended_at',
        'last_seen_at',
        'ended_reason',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'last_seen_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
