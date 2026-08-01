<?php

namespace App\Concerns;

use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Builder;

/**
 * ADR-0001: applies the mandatory tenant-scoping global scope and
 * auto-fills tenant_id from the request's TenantContext on create.
 *
 * The withoutGlobalScope opt-out (scopeAllTenants) is the "rare and
 * reviewed" exception ADR-0001 describes — used only by Super-Admin-gated
 * platform-level actions and by seeders/tests, never by ordinary request
 * handling.
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
}
