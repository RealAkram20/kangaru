<?php

namespace Modules\Trips\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Concerns\RecordsActingFleet;
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
use Modules\Trips\Distance\DistanceGrade;
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
 * @property string $channel Walk-in or corporate (ADR-0063 §5). Declared for the
 *                           same reason User::$access_level is: the column is a plain
 *                           string, so static analysis reads every isWalkIn() off it as
 *                           an undefined property and fails the level-8 gate.
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
 * @property int $unplanned_stop_count How many stops were added mid-run rather
 *                                     than planned (ADR-0045 §4) — surfaced, never billed.
 * @property string|null $billed_distance_km The resolver's figure (ADR-0045). Nothing
 *                                           prices from it yet — Phase 1 of `docs/measured-distance-plan.md` runs in shadow.
 * @property DistanceGrade|null $distance_grade
 * @property CarbonInterface|null $distance_resolved_at
 * @property string|null $provisional_distance_km The handset's own measurement of its buffered pings, sent with the completion (ADR-0045 §5).
 * @property int|null $fare_provisional_minor What the driver showed and took at the kerb; never overwritten.
 * @property CarbonInterface|null $distance_cleared_at
 * @property int|null $distance_cleared_by_user_id
 * @property string|null $distance_cleared_reason
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
    /** Kangaru's own work: no contract, priced by the public tariff. */
    public const CHANNEL_WALK_IN = 'walk_in';

    /** A client's contracted work. The default, and the safe default —
     * a row nobody set is not swept into Kangaru's commission. */
    public const CHANNEL_CORPORATE = 'corporate';

    /**
     * Set here as well as on the column, for the reason `OperatorClient`
     * records about its own status: **a database default applies on insert**,
     * so a `new Trip([...])` that is never saved carries null for it and every
     * read of that instance sees a trip with no channel.
     *
     * That is not hypothetical — `WalkInFareService::quote()` prices an
     * unsaved Trip through the real engine on purpose, and a null channel made
     * it resolve a *corporate* tariff for a walk-in estimate. The symptom was
     * "no default rate card has been set up", which points at configuration
     * rather than at the model.
     *
     * @var array<string, mixed>
     */
    protected $attributes = ['channel' => self::CHANNEL_CORPORATE];

    /** @use HasFactory<TripFactory> */
    use Auditable, BelongsToTenant, HasFactory, RecordsActingFleet, SoftDeletes;

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
        // The fleet whose driver ran this (ADR-0055). Set by `TripService`
        // from the assigned driver rather than from whoever is acting: the
        // fleet that did the work is a fact about the work, and a dispatcher
        // — or, after ADR-0056, a support agent acting as one — is not
        // necessarily in it. Null only on a walk-in nobody has accepted.
        'operator_id',
        'channel',
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
        'billed_distance_km',
        'distance_grade',
        'distance_resolved_at',
        'provisional_distance_km',
        'fare_provisional_minor',
        'distance_cleared_at',
        'distance_cleared_by_user_id',
        'distance_cleared_reason',
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
            'unplanned_stop_count' => 'integer',
            'billed_distance_km' => 'decimal:2',
            'distance_grade' => DistanceGrade::class,
            'distance_resolved_at' => 'datetime',
            'provisional_distance_km' => 'decimal:2',
            'fare_provisional_minor' => 'integer',
            'distance_cleared_at' => 'datetime',
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
    /**
     * Whether this trip is Kangaru's own walk-in work.
     *
     * **Reads the column, not the shape of the row.** `tenant_id === null` was
     * true of every walk-in and is not the same statement: ADR-0055 §2 refused
     * the inference because it *"would quietly stop being true the first time a
     * client-less booking exists for some other reason — and it would stop
     * being true silently, in the one predicate that decides what head office
     * reads."*
     *
     * ADR-0063 §5 made that urgent rather than tidy. This predicate now also
     * decides **which fares are split three ways**, so a trip on the wrong side
     * of it is no longer a display bug — it is money reaching the wrong
     * parties, with nothing anywhere reporting an error.
     */
    public function isWalkIn(): bool
    {
        return $this->channel === self::CHANNEL_WALK_IN;
    }

    /**
     * The current resolution of this trip's distance, or null when the
     * resolver has not run (ADR-0045).
     *
     * A query through `DistanceEvidence::scopeForTrip` rather than a
     * `HasOne`, because the evidence table's tenant is nullable and a
     * relation through `TenantScope` would return nothing for a walk-in —
     * the trap `TripEvent::scopeForTrip` documents.
     */
    public function latestDistanceEvidence(): ?DistanceEvidence
    {
        return DistanceEvidence::query()->forTrip($this)->first();
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
     * The stops this journey carried, in run order (ADR-0045 §1).
     *
     * **The tenant scope is dropped on the relation itself**, and that is
     * load-bearing rather than tidy: `TenantScope` fails closed, a driver's
     * request binds no tenant, and a walk-in trip's stops have none — so a
     * plain `hasMany` here would serve an empty itinerary on exactly the
     * requests that need it. `TripEvent::scopeForTrip` records this same trap
     * shipping silently once; the narrowing to one already-authorised trip is
     * the authorization, as it argues there.
     *
     * @return HasMany<TripStop, $this>
     */
    public function stops(): HasMany
    {
        return $this->hasMany(TripStop::class)
            ->withoutGlobalScope(TenantScope::class)
            ->orderBy('sequence');
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
