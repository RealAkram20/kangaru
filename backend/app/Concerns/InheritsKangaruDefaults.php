<?php

namespace App\Concerns;

use App\Enums\AccessLevel;
use App\Models\Operator;
use App\Models\User;
use App\Support\Access\AccessContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Reference data a fleet may override, falling back to Kangaru's default
 * (ADR-0055 §5).
 *
 * Four tables use this — `settings`, `vehicle_categories`, `zones` and
 * `rate_cards` — and on each of them a **null `operator_id` means Kangaru's
 * default**: readable by every fleet, editable only by Kangaru. A row that
 * names a fleet is that fleet's own, invisible to every other.
 *
 * ## This is a property of these four models, never of the column
 *
 * The distinction is load-bearing and worth stating where somebody will read it
 * before copying the pattern. On a walk-in booking a null `operator_id` will
 * mean *Kangaru's, unclaimed* — and if "a null fleet may be read by anyone"
 * escaped from here to there, every fleet on the platform would get every
 * walk-in customer's name, phone number and home address. That is the leak
 * ADR-0001 calls the worst bug this platform can have, arriving through a
 * helper nobody thought was security code.
 *
 * So the inheritance is opted into, model by model, by using this trait. It is
 * never inferred from the column being nullable. A table that wants "null means
 * unclaimed" simply does not use it.
 *
 * ## Two scopes, because there are two questions
 *
 * - `visibleToFleet()` — *what may this fleet read?* Its own rows plus Kangaru's
 *   defaults. This is the read path, and it is the shape `Zone::visibleTo`
 *   already had for the client axis; the fleet axis is the same idea one level
 *   up rather than a second idea.
 * - `ownedByFleet()` — *what may this fleet edit?* Its own rows only. Kangaru's
 *   defaults are excluded, which is what stops a fleet editing a price or a
 *   category that every other fleet reads.
 *
 * Keeping them apart is the whole point. One scope used for both would make
 * "can see the public tariff" and "can change the public tariff" the same
 * question, and they are emphatically not.
 *
 * @property int|null $operator_id
 */
trait InheritsKangaruDefaults
{
    /**
     * @return BelongsTo<Operator, $this>
     */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }

    /**
     * What this fleet may read: its own, plus Kangaru's defaults.
     *
     * A null `$operatorId` — Kangaru itself, or an unauthenticated context —
     * sees the defaults and no fleet's overrides, which is the honest answer
     * for both. Head office reads what head office owns; a request with nobody
     * on it reads the platform's own reference data and nothing private.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeVisibleToFleet(Builder $query, ?int $operatorId): Builder
    {
        $column = $this->getTable().'.operator_id';

        return $query->where(function (Builder $scoped) use ($column, $operatorId): void {
            $scoped->whereNull($column);

            if ($operatorId !== null) {
                $scoped->orWhere($column, $operatorId);
            }
        });
    }

    /**
     * What *this actor* may read — which is not the same question as
     * `visibleToFleet()`, and the difference is a bug this caught.
     *
     * `visibleToFleet(null)` means "Kangaru's defaults only", because a null
     * fleet is what head office has. But a **client's** user also has a null
     * `operator_id`, and they are not head office: filtering them the same way
     * hides every category, zone and price the fleet owns. It did exactly
     * that — `VehicleCategoryRateCardSyncTest` went red because a client's
     * Finance officer could no longer price the category the office had just
     * created.
     *
     * That is ADR-0055 §4's hazard wearing different clothes: two nulls, two
     * meanings, and only `access_level` can tell them apart. So this asks the
     * level rather than the column.
     *
     * - **Fleet** — its own rows plus Kangaru's defaults.
     * - **Kangaru** — the defaults it owns. It has no fleet's reference data
     *   and reaches a fleet's by acting as somebody in it (ADR-0056).
     * - **Client** — *unfiltered on this axis.* Which fleet serves them is the
     *   contract F2 introduces; until it exists, narrowing them would hide the
     *   prices on their own trips. Their client scoping is untouched and still
     *   does the isolating.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeVisibleToActor(Builder $query, User $actor): Builder
    {
        return match ($actor->access_level) {
            AccessLevel::FLEET => $this->scopeVisibleToFleet($query, $actor->operator_id),
            AccessLevel::KANGARU => $query->whereNull($this->getTable().'.operator_id'),
            AccessLevel::CLIENT => $query,
            // Reference data is not an applicant's to read either. They see
            // their own application; a price list is not part of it.
            AccessLevel::APPLICANT => $query->whereRaw('1 = 0'),
        };
    }

    /**
     * What this fleet may edit: its own rows, and never Kangaru's defaults.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeOwnedByFleet(Builder $query, ?int $operatorId): Builder
    {
        $column = $this->getTable().'.operator_id';

        return $operatorId === null
            ? $query->whereNull($column)
            : $query->where($column, $operatorId);
    }

    /**
     * The fleet currently acting, for callers that have no actor in hand.
     *
     * Reads the request's `AccessContext`, so it is null for Kangaru, for a
     * client and for anything running without a request — a queued job, a
     * console command, the scheduler. Each of those then sees Kangaru's
     * defaults, which for reference data is the correct floor rather than a
     * fail-closed nothing: a scheduled command that cannot read the platform's
     * own vehicle categories is broken, not safe.
     *
     * This is exactly the distinction F0 drew for `drivers` and `vehicles` and
     * refused to make there. It holds here because a Kangaru default is public
     * to every fleet by design, so an unbound reader learns nothing private by
     * seeing one.
     */
    public static function actingFleetId(): ?int
    {
        return app(AccessContext::class)->operatorId();
    }
}
