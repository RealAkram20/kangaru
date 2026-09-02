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
use Modules\Bookings\Models\Booking;
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
 * @property int|null $booking_id
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
 * @property string|null $allocation_override_reason
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
        'booking_id',
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
        'allocation_override_reason',
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

    /**
     * ADR-0068: an offer is raised for exactly one job, and the two kinds of
     * job are different tables.
     *
     * Asserted here rather than by a check constraint, and against the
     * attributes as the caller wrote them, for the reason `TripService`
     * gives about a trip's own two owners: this is where the mistake is
     * legible, and a constraint nobody reads teaches nobody anything. It
     * fires on update as well as create — an offer being re-pointed at a
     * second owner is the same bug arriving later.
     */
    protected static function booted(): void
    {
        parent::booted();

        static::saving(function (self $offer) {
            $owners = (int) ($offer->order_request_id !== null) + (int) ($offer->booking_id !== null);

            if ($owners !== 1) {
                throw new \LogicException(
                    'A dispatch offer belongs to exactly one order request or one booking, never both and never neither.'
                );
            }
        });
    }

    /** @return BelongsTo<OrderRequest, $this> */
    public function orderRequest(): BelongsTo
    {
        return $this->belongsTo(OrderRequest::class);
    }

    /** @return BelongsTo<Booking, $this> */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    /**
     * Where this job starts, whichever kind of job it is.
     *
     * The two owners name it differently — a walk-in has a
     * `pickup_location`, a booking has an `origin` — and three separate
     * callers needed the answer: the push that tells a driver what they are
     * being offered, the resource the offer screen renders, and the
     * ranking's own distance note. Asking each of them to know both
     * vocabularies is how the two channels drift apart, which is the drift
     * ADR-0064 avoided by sharing one service enum.
     */
    public function pickup(): ?string
    {
        return $this->orderRequest?->pickup_location ?? $this->booking?->origin;
    }

    /** The far end, read the same way and for the same reason as `pickup()`. */
    public function dropoff(): ?string
    {
        return $this->orderRequest?->dropoff_location ?? $this->booking?->destination;
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
