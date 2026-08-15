<?php

namespace Modules\Trips\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Customer;
use App\Models\Tenant;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Database\Factories\TripFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
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
 * @property int|null $tenant_id Null on a walk-in trip (ADR-0024 §1), which
 *                               is owned by a customer instead. Exactly one
 *                               of this and customer_id is ever set.
 * @property int|null $customer_id
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
 * @property int|null $fare_minor Whole shillings — UGX is zero-decimal. Null
 *                                until `WalkInFareService::settle()` prices the completed trip, and null
 *                                forever on a corporate trip, which is invoiced instead (ADR-0026 §2).
 * @property string|null $fare_currency
 * @property int|null $fare_rate_card_version_id What priced it, so the figure
 *                                               can be re-derived years later when somebody disputes it.
 * @property CarbonInterface|null $fare_computed_at
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

    /**
     * Keeps a walk-in trip tenantless (ADR-0024 §1).
     *
     * `BelongsToTenant` fills `tenant_id` from the ambient `TenantContext`
     * whenever it is null on create. That is correct for every other model
     * using the trait and cannot be correct here, because it cannot know
     * that a customer already owns this row — so a walk-in trip created
     * inside a request that happens to have a tenant bound would be filed
     * under that client, which is the cross-tenant leak ADR-0001 calls the
     * worst bug this platform can have.
     *
     * Registered in `booted()` rather than in the trait so it runs *after*
     * the trait's own hook and undoes it, and so the exception stays in the
     * one model the exception applies to.
     *
     * This corrects an ambient fill; it does not paper over a caller who
     * passed both owners. That is caught in `TripService`, against the
     * attributes as written, where the mistake is legible.
     */
    protected static function booted(): void
    {
        static::creating(function (self $trip) {
            if ($trip->customer_id !== null) {
                $trip->tenant_id = null;
            }
        });
    }

    protected $fillable = [
        'tenant_id',
        // ADR-0024 §1. The other owner: set on a walk-in trip, where
        // tenant_id is null. TripService is the only writer and asserts
        // that exactly one of the pair is present.
        'customer_id',
        'booking_id',
        'vehicle_id',
        'driver_id',
        // Why an allocated vehicle was not used (ADR-0009). Null means
        // nothing was overridden, not that nobody explained.
        'allocation_override_reason',
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
        // What the walk-in ride cost, and what priced it (ADR-0026 §3).
        // Recorded on the trip rather than in `invoices`, which answers
        // "what does this client owe" and has no place for a cash fare.
        'fare_minor',
        'fare_currency',
        'fare_rate_card_version_id',
        'fare_computed_at',
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
            'fare_minor' => 'integer',
            'fare_computed_at' => 'datetime',
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

    /**
     * The walk-in customer who ordered this trip (ADR-0024 §1). Null on
     * every corporate trip, which is owned by a tenant instead.
     *
     * @return BelongsTo<Customer, $this>
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /**
     * Whether this trip is a walk-in ride rather than a client's.
     *
     * `tenant_id === null`, and the first version had it as
     * `customer_id !== null` on the reasoning that the positive form says
     * what the trip *is*. That reasoning was wrong, and running the flow end
     * to end is what showed it: **a walk-in order does not have to have a
     * customer.** `POST /public/order-requests` is unauthenticated (ADR-0012
     * §3) and links to an account only when a customer token happens to
     * accompany it (ADR-0013 §4), so an anonymous order produces a trip with
     * no tenant *and* no customer.
     *
     * Those trips are walk-ins by every meaningful test — no client, a
     * contact name and number on the order request, a passenger standing at a
     * kerb — and the old spelling called them corporate. The visible symptom
     * was the driver's call button never appearing, because
     * `DirectContactChannel` asks this question first.
     *
     * So the invariant is "never both owners", not "always exactly one".
     * `TripService::assertExactlyOneOwner` only ever refused both, which was
     * right; the ADR's wording and this method were what overstated it.
     */
    public function isWalkIn(): bool
    {
        return $this->tenant_id === null;
    }

    /**
     * A customer's own trips, past the tenant scope (ADR-0024 §1).
     *
     * The named counterpart of `BelongsToTenant::forActor`, and it exists
     * for the same reason: `TenantScope` fails closed, so a query made in a
     * request with no tenant bound returns nothing at all — and a customer
     * never has a tenant bound, because a customer has no tenant. Reaching
     * for `allTenants()` here would be the raw opt-out that trait's docblock
     * now calls a review failure; this is the intent, spelled.
     *
     * The narrowing IS the authorization, exactly as in
     * `CustomerOrderRequestController`: every query starts from the token's
     * own customer_id, so there is no "may this customer see that row"
     * question left for a policy to get wrong.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForCustomer(Builder $query, Customer $customer): Builder
    {
        return $query
            ->withoutGlobalScope(TenantScope::class)
            ->where($this->getTable().'.customer_id', $customer->id);
    }

    /**
     * A driver's own trips, past the tenant scope — the sibling of
     * `forCustomer` above, and it exists for exactly the same reason.
     *
     * **`TenantScope` fails closed, and a driver's walk-in work has no
     * tenant.** With no tenant bound the scope appends `1 = 0`; with one
     * bound it appends `tenant_id = X`, which excludes every walk-in, whose
     * `tenant_id` is null by definition (`isWalkIn()` above). Either way a
     * plain `Trip::query()->where('driver_id', …)` from a `/me` endpoint
     * silently loses the trips a boda rider actually did — silently being the
     * dangerous half. `DriverLedgerController` records the same trap costing
     * that endpoint a test.
     *
     * The narrowing **is** the authorization, as in `forCustomer`: every query
     * starts from the token's own driver, so there is no "may this driver see
     * that row" question left for a policy to answer wrongly. This is why
     * `/me/trips` needs no policy and `drivers/{driver}/trips` would.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForDriver(Builder $query, Driver $driver): Builder
    {
        return $query
            ->withoutGlobalScope(TenantScope::class)
            ->where($this->getTable().'.driver_id', $driver->getKey());
    }

    /** @return HasMany<TripEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(TripEvent::class)->orderBy('created_at');
    }

    /**
     * The walk-in order this trip was born from (ADR-0024 §3), or null.
     *
     * **A `hasOne` against `order_requests.trip_id`, not a column on this
     * table.** The link already existed in that direction — `DispatchOffer
     * Service` writes it on the accept, and the race check reads it — so
     * adding `trips.order_request_id` would have been a second edge for the
     * same fact, and the two would disagree the first time one was written
     * without the other.
     *
     * What it is *for* is the coordinates. A trip carries `origin` and
     * `destination` as prose, because that is all a dispatcher keying one in
     * has; the order request behind a walk-in carries latitude and longitude
     * as well, and a driver's pickup screen cannot draw a map or measure a
     * leg from a street name. Null on every corporate trip, and null on a
     * walk-in that a dispatcher fulfilled by hand — both of which render as
     * a screen with no map rather than a map of nowhere.
     *
     * @return HasOne<OrderRequest, $this>
     */
    public function orderRequest(): HasOne
    {
        return $this->hasOne(OrderRequest::class, 'trip_id');
    }

    /**
     * What this trip did to the driver's wallet.
     *
     * Written as a pair at completion by `DriverLedgerService` — a
     * `fare_earned` credit and a `cash_collected` debit — and read back by
     * `TripResource` so the driver can be shown their own share of the job
     * they just finished. Nothing else on the platform reads it per-trip; the
     * home screen's figures are aggregates over the whole ledger.
     *
     * **Eager-load this only where one trip is being served.** It is unbounded
     * per row, so loading it on a list endpoint is the N+1 AGENTS.md forbids —
     * `TripController::show()` loads it and `index()` does not, the same bound
     * `orderRequest` carries and for the same reason.
     *
     * @return HasMany<DriverLedgerEntry, $this>
     */
    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(DriverLedgerEntry::class, 'trip_id');
    }
}
