<?php

namespace App\Concerns;

use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Builder;

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
        return $actor->isPlatformLevel()
            ? $query->withoutGlobalScope(TenantScope::class)
            : $query;
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

        /** @var static|null */
        return $this->resolveRouteBindingQuery($query, $value, $field)->first();
    }
}
