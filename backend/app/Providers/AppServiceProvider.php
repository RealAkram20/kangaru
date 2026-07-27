<?php

namespace App\Providers;

use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
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
    }
}
