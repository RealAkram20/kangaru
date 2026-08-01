<?php

namespace App\Providers;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Modules\Administration\Policies\AuditLogPolicy;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Policies\BookingPolicy;
use Modules\Clients\Models\Company;
use Modules\Clients\Policies\CompanyPolicy;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Policies\DriverPolicy;
use Modules\Trips\Models\Trip;
use Modules\Trips\Policies\TripPolicy;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Policies\VehiclePolicy;

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
        Gate::policy(Vehicle::class, VehiclePolicy::class);
        Gate::policy(Driver::class, DriverPolicy::class);
        Gate::policy(Trip::class, TripPolicy::class);
        Gate::policy(Booking::class, BookingPolicy::class);

        // Stable short aliases for audit_logs.auditable_type instead of raw
        // FQCNs — extend this map when Billing/etc. models start using
        // Auditable.
        Relation::enforceMorphMap([
            'company' => Company::class,
            'user' => User::class,
            'vehicle' => Vehicle::class,
            'driver' => Driver::class,
            'trip' => Trip::class,
            'booking' => Booking::class,
        ]);
    }
}
