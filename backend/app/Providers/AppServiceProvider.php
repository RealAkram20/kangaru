<?php

namespace App\Providers;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Modules\Administration\Policies\AuditLogPolicy;
use Modules\Clients\Models\Company;
use Modules\Clients\Policies\CompanyPolicy;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(TenantContext::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Explicit registration rather than relying on Laravel's naming-
        // convention policy guesser across the Modules\ namespace.
        Gate::policy(Company::class, CompanyPolicy::class);
        Gate::policy(AuditLog::class, AuditLogPolicy::class);

        // Stable short aliases for audit_logs.auditable_type instead of raw
        // FQCNs — extend this map when Billing/etc. models start using
        // Auditable.
        Relation::enforceMorphMap([
            'company' => Company::class,
            'user' => User::class,
        ]);
    }
}
