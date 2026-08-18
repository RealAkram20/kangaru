<?php

namespace Modules\Dispatch\Models;

use App\Concerns\Auditable;
use Carbon\CarbonInterface;
use Database\Factories\DispatchOfferFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * A job put in front of one driver, with a clock on it (ADR-0024 §3).
 *
 * `status` is only ever changed by `DispatchOfferService`, for the same
 * reason `Trip::status` and `Booking::status` are gated: the expiry rule and
 * the accept race both live in that service, and a `DispatchOffer::update`
 * elsewhere would bypass them.
 *
 * **No `BelongsToTenant`**, deliberately — a walk-in is the platform's
 * customer (ADR-0005) and an offer to one of the platform's drivers belongs
 * to no client. `Auditable` still applies; `AuditLog::record()` already
 * stores a null tenant for a model without one.
 *
 * @property int $id
 * @property int|null $order_request_id
 * @property int $driver_id
 * @property int|null $vehicle_id
 * @property DispatchOfferStatus $status
 * @property int $round
 * @property int $rank
 * @property string|null $score
 * @property string|null $pickup_distance_km
 * @property array<int, string>|null $reasons
 * @property CarbonInterface $offered_at
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $responded_at
 * @property string|null $decline_reason
 * @property int|null $trip_id
 */
class DispatchOffer extends Model
{
    /** @use HasFactory<DispatchOfferFactory> */
    use Auditable, HasFactory;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return DispatchOfferFactory::new();
    }

    protected $fillable = [
        'order_request_id',
        'driver_id',
        'vehicle_id',
        'status',
        'round',
        'rank',
        'score',
        'pickup_distance_km',
        'reasons',
        'offered_at',
        'expires_at',
        'responded_at',
        'decline_reason',
        'trip_id',
    ];

    protected function casts(): array
    {
        return [
            'status' => DispatchOfferStatus::class,
            'round' => 'integer',
            'rank' => 'integer',
            // Cast to float, because MariaDB hands DECIMAL back as a
            // *string* — the same correction ADR-0020 records making on the
            // booking coordinates, where the API emitted "0.3476000" to a
            // client expecting a number.
            'score' => 'float',
            'pickup_distance_km' => 'float',
            'reasons' => 'array',
            'offered_at' => 'datetime',
            'expires_at' => 'datetime',
            'responded_at' => 'datetime',
        ];
    }

    /**
     * Whether this offer can still be answered **right now**.
     *
     * Both halves matter, and the clock is the half that is easy to forget.
     * ADR-0024 §5: an offer expires because `expires_at` has passed, not
     * because a job ran — so a stored status of `offered` is not on its own
     * evidence that anybody may still accept. Every read asks this question
     * rather than trusting the column, which is what makes the system
     * correct when the scheduler is dead.
     */
    public function isLive(): bool
    {
        return $this->status->isOpen() && $this->expires_at->isFuture();
    }

    /**
     * Offers that have run out of time but are still marked open.
     *
     * The backlog `dispatch:advance-offers` works through, and the same
     * predicate the accept path uses to refuse a late answer.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeLapsed(Builder $query): Builder
    {
        return $query
            ->where('status', DispatchOfferStatus::OFFERED)
            ->where('expires_at', '<=', now());
    }

    /**
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeLive(Builder $query): Builder
    {
        return $query
            ->where('status', DispatchOfferStatus::OFFERED)
            ->where('expires_at', '>', now());
    }

    /** @return BelongsTo<OrderRequest, $this> */
    public function orderRequest(): BelongsTo
    {
        return $this->belongsTo(OrderRequest::class);
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /** @return BelongsTo<Vehicle, $this> */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }
}
