<?php

namespace App\Support\Tenancy;

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
}
