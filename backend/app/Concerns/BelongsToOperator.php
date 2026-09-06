<?php

namespace App\Concerns;

use App\Enums\AccessLevel;
use App\Models\User;
use App\Support\Access\AccessContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * A row that belongs to a fleet company (ADR-0055).
 *
 * The deliberate half-sibling of `BelongsToTenant`: it auto-fills `operator_id`
 * from the request's `AccessContext` in the same way and for the same reason,
 * and it **does not add a global scope**.
 *
 * ## Why no global scope, when the client axis has one
 *
 * `drivers` and `vehicles` carry no global scope at all today — ADR-0005
 * removed `tenant_id` from both — so adding a fail-closed one is not a
 * tightening, it is a new failure mode on two tables that have never had one.
 * Two things break immediately, and neither breaks loudly:
 *
 * - **Unbound contexts read nothing.** `AdvanceDispatchOffers` runs every ten
 *   seconds with no actor and reaches drivers through `DispatchOfferService`;
 *   `AwardWeeklyBonuses` and `CloseStaleDutySessions` do the same. A
 *   fail-closed scope turns all three into silent no-ops — *"dispatch stalls,
 *   no error anywhere"*, which `docs/master-plan.md` names as the failure it
 *   most fears.
 * - **A client loading `trip.driver` gets null.** ADR-0055 §3 says a client
 *   actor gets no rows from a fleet-owned table, which is right for a *listing*
 *   and wrong for the driver of the client's own trip. The ADR does not
 *   distinguish the two; the code found the gap, and F2 answers it.
 *
 * ADR-0006 needed a whole ADR — `forActor()`, `resolveRouteBinding()` and the
 * `BindSubjectTenant` middleware — to make fail-closed workable on the client
 * axis. The fleet axis deserves the same care, in the package that can test it
 * as a unit. Until then `forActor()` below is the honest scope: opt-in at the
 * listing, which is where cross-fleet reads would actually happen.
 *
 * @property int|null $operator_id
 */
trait BelongsToOperator
{
    /**
     * The stamping half lives in its own trait so that `trips`, `bookings`,
     * `invoices` and `credit_notes` can have it without this one: they are
     * tenant-scoped, `BelongsToTenant` already defines `scopeForActor()`, and
     * two traits defining one method is a fatal collision rather than a
     * preference.
     */
    use RecordsActingFleet;

    /**
     * Narrow a listing to what this actor's fleet may see.
     *
     * Written the way `User::scopeForActor` is — adding a `where` rather than
     * dropping a scope — because these models carry no global scope to drop.
     * Same name on purpose: a reader who knows one knows the other.
     *
     * - **Fleet staff** see their own fleet's rows, and only those.
     * - **Kangaru** sees rows with no fleet. On `drivers` and `vehicles` that
     *   column is NOT NULL, so head office sees none — which is correct and
     *   says so in the predicate rather than in a comment. Kangaru owns no
     *   fleet (ADR-0055 §5); it reaches one by acting as somebody in it.
     * - **A client** sees none. They hold neither `drivers.view` nor
     *   `vehicles.view` (`RoleSeeder`), so this agrees with the permission
     *   catalogue rather than contradicting it.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForActor(Builder $query, User $actor): Builder
    {
        return match ($actor->access_level) {
            AccessLevel::FLEET => $query->where(
                $this->getTable().'.operator_id', $actor->operator_id
            ),
            AccessLevel::KANGARU => $query->whereNull($this->getTable().'.operator_id'),
            AccessLevel::CLIENT => $query->whereRaw('1 = 0'),
            // An applicant has no fleet and no business reading one's.
            AccessLevel::APPLICANT => $query->whereRaw('1 = 0'),
        };
    }
}
