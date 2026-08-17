<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\TripEventImmutableException;
use App\Models\User;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Trips\Enums\TripStatus;

/**
 * Append-only trip timeline (AGENTS.md: "Every transition is timestamped
 * in an append-only trip_events table"). Written exclusively via the
 * static record() factory — never constructed/saved directly elsewhere.
 * Structurally mirrors App\Models\AuditLog.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $trip_id
 * @property TripStatus|null $from_status
 * @property TripStatus $to_status
 * @property int|null $user_id
 * @property string|null $notes
 * @property CarbonInterface $created_at
 */
class TripEvent extends Model
{
    use BelongsToTenant;

    /**
     * No updated_at column exists — this table is append-only.
     */
    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'trip_id',
        'from_status',
        'to_status',
        'user_id',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'from_status' => TripStatus::class,
            'to_status' => TripStatus::class,
        ];
    }

    /**
     * The timeline of one trip the caller has already been authorised for.
     *
     * ## The bug this fixes, which was silent and shipped
     *
     * **`GET /trips/{id}/events` returned an empty timeline for every walk-in
     * trip.** `TenantScope` fails closed, and a walk-in has no tenant by
     * definition (ADR-0024 §1): with no tenant bound the scope appends
     * `1 = 0`, and with one bound it appends `tenant_id = X`, which excludes a
     * row whose tenant is null. Either way a relation query through
     * `$trip->events()` loses the whole timeline — and *only* on the trips a
     * driver actually does, which is why nothing caught it.
     *
     * The symptom was misread once already: the trip-in-progress screen showed
     * an em dash for elapsed time on a trip that was visibly running, and
     * `progress.ts::startedAtFrom` gained a fallback to `trips.started_at` to
     * paper over it. That fallback is still right for its own reason (the
     * timeline arrives in a second request) but it was hiding this.
     *
     * ## Why dropping the scope here is safe, and where it is not
     *
     * **The narrowing is the authorization**, exactly as `Trip::scopeForDriver`
     * and `scopeForCustomer` argue: every query starts from a single trip that
     * the caller has already passed a policy for, so the only rows this can
     * return belong to a trip they may read. There is no "may this user see
     * that row" question left.
     *
     * It is a *named* scope rather than a raw `allTenants()` in a controller
     * for the reason `BelongsToTenant`'s docblock gives: the raw opt-out is a
     * review failure precisely because it does not say why.
     *
     * **This does not fix the same trap in Billing.**
     * `WaitingTimeCalculator::secondsFor()` reads `TripEvent::query()` with the
     * scope still applied, so it computes zero waiting seconds for every
     * walk-in trip and no walk-in fare has ever carried a waiting charge. That
     * is money rather than a screen, so it is reported rather than changed
     * here — see `docs/agent-worklog.md`.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForTrip(Builder $query, Trip $trip): Builder
    {
        return $query
            ->withoutGlobalScope(TenantScope::class)
            ->where($this->getTable().'.trip_id', $trip->getKey());
    }

    public static function booted(): void
    {
        static::updating(function () {
            throw new TripEventImmutableException;
        });

        static::deleting(function () {
            throw new TripEventImmutableException;
        });
    }

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function record(Trip $trip, ?TripStatus $from, TripStatus $to, ?User $actor, ?string $notes): self
    {
        return static::create([
            'tenant_id' => $trip->tenant_id,
            'trip_id' => $trip->id,
            'from_status' => $from,
            'to_status' => $to,
            'user_id' => $actor?->id,
            'notes' => $notes,
        ]);
    }
}
