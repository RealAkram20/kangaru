<?php

namespace Modules\Bookings\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Database\Factories\BookingFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * A request for transport, before a vehicle and driver exist on it. The
 * booking is what a Corporate Employee raises and a Dispatcher works from;
 * the Trip is what Dispatch creates when it assigns one.
 *
 * `status` is only ever changed by Modules\Bookings\Services\BookingService
 * (the approval decisions) and Modules\Dispatch (the move to Assigned) —
 * never by a raw update, for the same reason Trip::status is gated.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $requested_by_user_id
 * @property string $origin
 * @property string $destination
 * @property BookingStatus $status
 * @property Carbon|null $scheduled_for
 * @property int|null $approved_by_user_id
 * @property Carbon|null $approved_at
 * @property string|null $decision_reason
 */
class Booking extends Model
{
    /** @use HasFactory<BookingFactory> */
    use Auditable, BelongsToTenant, HasFactory, SoftDeletes;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return BookingFactory::new();
    }

    protected $fillable = [
        'tenant_id',
        'requested_by_user_id',
        'passenger_name',
        'passenger_phone',
        'passenger_count',
        'origin',
        // ADR-0020: where the pickup actually is, when the caller knew.
        // Nullable — every booking that predates this has none, and the
        // recommender ranks without distance for those rather than
        // refusing to answer.
        'origin_latitude',
        'origin_longitude',
        'destination',
        'scheduled_for',
        'status',
        'approved_by_user_id',
        'approved_at',
        'decision_reason',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            // See OrderRequest: MariaDB returns DECIMAL as a string, and the
            // matcher's `(float)` casts would hide that from PHP while the
            // API still emitted a string to every client (ADR-0020 §2).
            'origin_latitude' => 'float',
            'origin_longitude' => 'float',
            'status' => BookingStatus::class,
            'passenger_count' => 'integer',
            'scheduled_for' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    /** A booking with no `scheduled_for` is an immediate ("now") request. */
    public function isImmediate(): bool
    {
        return $this->scheduled_for === null;
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    /**
     * At most one — `trips.booking_id` carries a unique index.
     *
     * @return HasOne<Trip, $this>
     */
    public function trip(): HasOne
    {
        return $this->hasOne(Trip::class);
    }
}
