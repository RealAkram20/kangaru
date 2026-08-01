<?php

namespace Modules\Trips\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use Carbon\CarbonInterface;
use Database\Factories\TripFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Vehicles\Models\Vehicle;

/**
 * The trip lifecycle record delivering the Bank's six Phase-1 acceptance
 * criteria (start/completion timestamps, vehicle registration, origin/
 * destination, opening/closing odometer, distance, duration). Every
 * mutation to status or the bank-required fields must go through
 * Modules\Trips\Services\TripStateMachine — never `Trip::update(['status'
 * => ...])` directly, which would bypass the transition map, side
 * effects, and the trip_events timeline AGENTS.md requires.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int|null $booking_id
 * @property int $vehicle_id
 * @property int $driver_id
 * @property string $origin
 * @property string $destination
 * @property TripStatus $status
 * @property int|null $odometer_start
 * @property int|null $odometer_end
 * @property string|null $distance_km
 * @property string|null $gps_distance_km
 * @property bool $distance_variance_flagged
 * @property bool|null $cancellation_charge_applicable
 * @property CarbonInterface|null $started_at
 * @property CarbonInterface|null $completed_at
 * @property CarbonInterface $created_at
 * @property CarbonInterface $updated_at
 * @property-read Vehicle|null $vehicle
 * @property-read Driver|null $driver
 */
class Trip extends Model
{
    /** @use HasFactory<TripFactory> */
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return TripFactory::new();
    }

    protected $fillable = [
        'tenant_id',
        'booking_id',
        'vehicle_id',
        'driver_id',
        'origin',
        'destination',
        'status',
        'odometer_start',
        'odometer_start_photo_path',
        'odometer_end',
        'odometer_end_photo_path',
        'distance_km',
        'gps_distance_km',
        'distance_variance_flagged',
        'cancellation_charge_applicable',
        'started_at',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => TripStatus::class,
            'odometer_start' => 'integer',
            'odometer_end' => 'integer',
            'distance_km' => 'decimal:2',
            'gps_distance_km' => 'decimal:2',
            'distance_variance_flagged' => 'boolean',
            'cancellation_charge_applicable' => 'boolean',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /**
     * The Bank's sixth acceptance criterion (PROJECT.md): "trip duration in
     * hours/minutes". Derived from the state machine's started_at/completed_at
     * rather than stored, so it can never drift from the timeline — and
     * deliberately not computed from trip_events, which measure waiting
     * time for billing, a different quantity.
     *
     * Null until the trip has both started and completed.
     */
    public function durationMinutes(): ?int
    {
        if ($this->started_at === null || $this->completed_at === null) {
            return null;
        }

        return (int) $this->started_at->diffInMinutes($this->completed_at);
    }

    /**
     * Null for an ad-hoc trip raised directly at the desk, with no booking.
     *
     * @return BelongsTo<Booking, $this>
     */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    /** @return BelongsTo<Vehicle, $this> */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return HasMany<TripEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(TripEvent::class)->orderBy('created_at');
    }
}
