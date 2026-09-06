<?php

namespace App\Concerns;

use App\Enums\AccessLevel;
use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * ADR-0001: applies the mandatory tenant-scoping global scope and
 * auto-fills tenant_id from the request's TenantContext on create.
 *
 * The withoutGlobalScope opt-out (scopeAllTenants) is the "rare and
 * reviewed" exception ADR-0001 describes. Since ADR-0006 it means one
 * specific thing: **there is no actor** — seeders, queued jobs and console
 * commands. A request path that needs to read past its own tenant asks
 * `forActor()` instead, because that is the thing which expresses the
 * intent, and a raw `allTenants()` in a controller or service is now a
 * review failure.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        static::creating(function ($model) {
            if ($model->tenant_id === null) {
                $model->tenant_id = app(TenantContext::class)->get();
            }
        });
    }

    /**
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeAllTenants(Builder $query): Builder
    {
        return $query->withoutGlobalScope(TenantScope::class);
    }

    /**
     * The one named way past tenant scoping in a request path (ADR-0006).
     *
     * - An actor with a `tenant_id` gets normal tenant scoping, unchanged.
     * - An actor with none is platform staff — Shanitah's dispatchers,
     *   Finance, Operations — and the global scope is dropped for this
     *   query.
     *
     * `tenant_id` being null answers *whose* rows; it does not answer
     * *what* the actor may see. That is still ADR-0004's permission
     * catalogue, checked by the policy as it always was: a platform
     * Dispatcher holding `trips.view.all` reads every client's trips and,
     * lacking `invoices.view`, reads no client's money. Dropping the scope
     * here grants nothing on its own.
     *
     * This replaces five hand-rolled copies of the same predicate —
     * CompanyService, UserController, UserAdminService, UserPolicy and
     * AuditLogController each wrote it out, in four modules, with no shared
     * name. The sixth copy was the one that would eventually get it
     * backwards.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForActor(Builder $query, User $actor): Builder
    {
        if (! $actor->isPlatformLevel()) {
            return $query;
        }

        $query->withoutGlobalScope(TenantScope::class);

        return $this->narrowToFleet($query, $actor);
    }

    /**
     * The fleet half of `forActor()` (ADR-0055 §6).
     *
     * Dropping the tenant scope answers *"this actor reads across clients"*,
     * which was the whole question while one fleet existed. It is now half of
     * one: **which clients** is still open, and left open it means a second
     * fleet's dispatcher reads the first fleet's trips, bookings and invoices.
     *
     * Applied only to models that actually record a fleet — `Trip`, `Booking`,
     * `Invoice`, `CreditNote`. The other fifteen tenant-scoped models have no
     * `operator_id` to filter on, and adding a predicate against a column that
     * is not there would be a fatal error rather than a leak, which is at
     * least honest but not useful.
     *
     * ## Why `OR operator_id IS NULL`, which looks like a hole and is not
     *
     * A null fleet on a booking means **Kangaru's, unclaimed** (ADR-0055 §7) —
     * a walk-in nobody has accepted. Those are created by a customer, whose
     * request binds no fleet at all, so a bare `where operator_id = mine`
     * would make every unclaimed walk-in **invisible to dispatch**. The queue
     * would empty silently and nobody would be told; it is precisely the shape
     * of failure `docs/master-plan.md` calls the one it most fears.
     *
     * So unclaimed work is visible to every fleet, and that is correct for
     * today and wrong for F3, where ADR-0055 §7 makes reaching walk-in demand
     * a **grant** rather than a default. When that lands, this `orWhereNull`
     * is the line it replaces. Named here so it is found, rather than
     * discovered by a fleet reading a queue it was never granted.
     *
     * Typed against the model rather than `static` on purpose: this is called
     * both from a scope (which has `Builder<static>`) and from
     * `resolveRouteBinding()`, where `newQuery()` yields `Builder<TModel>`.
     * A `static` signature makes the second call site a variance error in
     * static analysis for every one of the twenty models using this trait.
     *
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    private function narrowToFleet(Builder $query, User $actor): Builder
    {
        if (! in_array(RecordsActingFleet::class, class_uses_recursive(static::class), true)) {
            return $query;
        }

        $column = $this->getTable().'.operator_id';

        return $query->where(function (Builder $scoped) use ($column, $actor): void {
            $scoped->where($column, $actor->operator_id)->orWhereNull($column);
        });
    }

    /**
     * Route-model binding, made actor-aware for the same reason (ADR-0006).
     *
     * Without this a platform user 404s on every single-resource route in
     * the application, including ones they hold the permission for:
     * `SubstituteBindings` resolves `{trip}` through the global scope, which
     * fails closed with no tenant bound. That is the shape of the Super
     * Admin's empty platform today — the listing was only half of it.
     *
     * Resolution is not authorization. The policy still runs afterwards, so
     * a platform Dispatcher who resolves an invoice by id is refused by
     * `InvoicePolicy` exactly as they are refused the listing. A 403 rather
     * than a 404 is right here: AGENTS.md's "404 masks cross-tenant IDs"
     * exists so one client cannot probe another's identifiers, and platform
     * staff are not another client.
     *
     * @param  mixed  $value
     * @param  string|null  $field
     */
    public function resolveRouteBinding($value, $field = null): ?static
    {
        $query = $this->newQuery();

        $actor = request()->user();

        if ($actor instanceof User && $actor->isPlatformLevel()) {
            $query->withoutGlobalScope(TenantScope::class);

            // …and narrowed to their own fleet (ADR-0055 §6).
            //
            // ADR-0006's implementation note says route-model binding "was
            // half the bug" for the client axis, because a listing patched by
            // hand still left every single-resource URL resolving through the
            // global scope. The fleet axis inherits that lesson rather than
            // re-learning it: without this line a second fleet's dispatcher
            // could not *list* the first fleet's trips but could open any of
            // them by id.
            //
            // The policy still runs afterwards — resolution is not
            // authorization — and a 404 here is the right answer rather than a
            // 403, because a fleet must not be able to probe a competitor's
            // identifiers by watching status codes.
            $this->narrowToFleet($query, $actor);
        }

        /*
         * A customer is the other actor with no tenant (security-gate F5).
         *
         * Customer routes run no `IdentifyTenant`, so for them the scope
         * always fails closed — which made `POST /customer/trips/{trip}/
         * rating` 404 for every customer including on their own completed
         * trip, before `TripRatingController` ever ran. The owner rated a
         * real ride and nothing arrived; the controller's own "No such
         * trip." was never reached (the 404 was the framework's — the tell
         * the census recorded).
         *
         * Resolution is not authorization, exactly as for platform staff
         * above: every customer controller refuses a record that is not
         * theirs, and with the same 404 the scope would have given —
         * `TripRatingController` compares `customer_id` before anything
         * else — so cross-customer ids stay masked.
         */
        if ($actor instanceof Customer) {
            $query->withoutGlobalScope(TenantScope::class);
        }

        /*
         * Head office, on the models that have opted in (ADR-0062).
         *
         * `isPlatformLevel()` means **fleet** since ADR-0055, so a Kangaru
         * actor falls past the branch above into `TenantScope` failing closed
         * — `where 1 = 0` — and 404s on every single-resource URL. `K6` hit
         * exactly this on the *listing* and amended it in `CompanyService`;
         * the binding was the other half and was left, so head office could
         * see its client directory and could not open or edit one row of it.
         * Third sighting on this branch of a listing patched without its URL.
         *
         * **Opt-in per model rather than blanket**, because the blanket
         * version is a real widening: head office would resolve any
         * tenant-scoped record by id — trips, bookings, invoices — and
         * ADR-0062 §2 draws the line precisely there. The directory is
         * Kangaru's; the operations are the fleet's, reached by acting as
         * somebody in it. Resolution is still not authorization, and the
         * policy runs afterwards either way.
         */
        if ($actor instanceof User
            && $actor->access_level === AccessLevel::KANGARU
            && $this->headOfficeResolvesByRoute()) {
            $query->withoutGlobalScope(TenantScope::class);
        }

        /** @var static|null */
        return $this->resolveRouteBindingQuery($query, $value, $field)->first();
    }

    /**
     * Whether head office may resolve this model by id (ADR-0062 §2).
     *
     * `false` here so that adding the trait to a new model never silently
     * opens it to Kangaru: a model becomes part of the directory by saying so,
     * which is one line and a decision, rather than by omission.
     */
    protected function headOfficeResolvesByRoute(): bool
    {
        return false;
    }
}
