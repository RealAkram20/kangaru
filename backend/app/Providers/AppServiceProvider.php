<?php

namespace App\Providers;

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Modules\Administration\Policies\AuditLogPolicy;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Policies\InvoicePolicy;
use Modules\Billing\Policies\RateCardPolicy;
use Modules\Bookings\Events\BookingApproved;
use Modules\Bookings\Events\BookingRejected;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Policies\BookingPolicy;
use Modules\Clients\Models\Company;
use Modules\Clients\Policies\CompanyPolicy;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Policies\DriverPolicy;
use Modules\Notifications\Listeners\SendBookingDecisionNotification;
use Modules\Notifications\Listeners\SendReportExportReadyNotification;
use Modules\Reports\Events\ReportExportCompleted;
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
        Gate::policy(RateCard::class, RateCardPolicy::class);
        Gate::policy(Invoice::class, InvoicePolicy::class);

        // A Gate rather than a Policy: reports are not a model, and
        // AGENTS.md's authorization rule names Gates alongside Policies.
        // Drivers and Corporate Employees are excluded — a report spans
        // the whole tenant's fleet, which is more than either should see.
        Gate::define('viewReports', fn (User $user) => in_array($user->role, [
            UserRole::SUPER_ADMIN,
            UserRole::OPERATIONS_MANAGER,
            UserRole::DISPATCHER,
            UserRole::FINANCE,
            UserRole::FLEET_OWNER,
            UserRole::BRANCH_MANAGER,
            UserRole::DEPOT_MANAGER,
            UserRole::CORPORATE_ADMIN,
        ], true));

        // Explicit listener registration, for the same reason the policies
        // above are explicit: Laravel's event discovery scans app/Listeners
        // by convention and would never look under Modules\.
        //
        // Registered here rather than in a Notifications service provider
        // because this application has one provider and adding a second
        // for two lines would be more indirection than it removes.
        Event::listen(BookingApproved::class, [SendBookingDecisionNotification::class, 'approved']);
        Event::listen(BookingRejected::class, [SendBookingDecisionNotification::class, 'rejected']);
        Event::listen(ReportExportCompleted::class, SendReportExportReadyNotification::class);

        // Stable short aliases for audit_logs.auditable_type instead of raw
        // FQCNs. Every Auditable model must appear here — a missing entry
        // writes the FQCN instead, and moving the class later would orphan
        // the audit rows that reference it.
        //
        // AGENTS.md requires an audit trail over "rate cards, contracts,
        // invoices, payments, roles/permissions, and credit limits"; the
        // five Billing entries below are the rate-card and invoice halves
        // of that. Invoice/credit-note *lines* are not audited: they are
        // created with their parent and can never change, so the parent's
        // own row already covers them.
        Relation::enforceMorphMap([
            'company' => Company::class,
            'user' => User::class,
            'vehicle' => Vehicle::class,
            'driver' => Driver::class,
            'trip' => Trip::class,
            'booking' => Booking::class,
            'rate_card' => RateCard::class,
            'rate_card_version' => RateCardVersion::class,
            'rate_card_rate' => RateCardRate::class,
            'invoice' => Invoice::class,
            'credit_note' => CreditNote::class,
        ]);
    }
}
