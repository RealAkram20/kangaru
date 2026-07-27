<?php

namespace App\Support\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * ADR-0001 enforcement point. Applied globally by the BelongsToTenant trait.
 *
 * Deliberately fails closed: if no tenant is bound to the request (e.g. a
 * background job or console command that never went through IdentifyTenant),
 * the scope excludes every row rather than silently returning all tenants'
 * data. Cross-tenant/no-tenant code paths must explicitly opt out via
 * Model::allTenants() and set tenant_id manually — never rely on this scope
 * being absent by accident.
 */
class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        /** @var TenantContext $context */
        $context = app(TenantContext::class);

        if ($context->check()) {
            $builder->where($model->getTable().'.tenant_id', $context->get());

            return;
        }

        $builder->whereRaw('1 = 0');
    }
}
