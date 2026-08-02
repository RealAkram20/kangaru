<?php

namespace App\Support\Tenancy;

use Throwable;

/**
 * Holds the "current tenant" for the request. Bound as a singleton in
 * AppServiceProvider so the same instance is shared across the request
 * lifecycle (set once by IdentifyTenant middleware, read by TenantScope).
 */
class TenantContext
{
    private ?int $tenantId = null;

    public function set(?int $tenantId): void
    {
        $this->tenantId = $tenantId;
    }

    public function get(): ?int
    {
        return $this->tenantId;
    }

    public function check(): bool
    {
        return $this->tenantId !== null;
    }

    /**
     * Run `$callback` bound to `$tenantId`, then put back whatever was bound
     * before — including when the callback throws (ADR-0006).
     *
     * This is how platform staff write. They have no tenant of their own, so
     * `BelongsToTenant::creating` would auto-fill `tenant_id` null and hit a
     * non-nullable foreign key; a platform dispatcher assigning Centenary
     * Bank's booking runs with the Bank's tenant bound instead, so the trip,
     * its trip_events and its notifications all land in the right place.
     *
     * **The `finally` is the whole point.** A failed dispatch that threw
     * halfway would otherwise leave the rest of the request bound to a client
     * the actor is not acting on — the next query in the same request would
     * read, or write, somebody else's rows. `TenantContext` is a singleton
     * for the request's lifetime, so a leak here is not scoped to the call
     * that caused it. `PlatformTenantBindingTest` asserts restoration after a
     * throw specifically, not just after a return.
     *
     * @template TReturn
     *
     * @param  callable(): TReturn  $callback
     * @return TReturn
     *
     * @throws Throwable whatever the callback threw, after the restore
     */
    public function for(?int $tenantId, callable $callback): mixed
    {
        $previous = $this->tenantId;
        $this->tenantId = $tenantId;

        try {
            return $callback();
        } finally {
            $this->tenantId = $previous;
        }
    }
}
