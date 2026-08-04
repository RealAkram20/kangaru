<?php

namespace App\Providers;

use App\Enums\Permission;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\AuditLogPolicy;
use Modules\Administration\Policies\RolePolicy;
use Modules\Administration\Policies\UserPolicy;
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
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Policies\BookingPolicy;
use Modules\Bookings\Policies\OrderRequestPolicy;
use Modules\Clients\Models\Company;
use Modules\Clients\Policies\CompanyPolicy;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Policies\DriverPolicy;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Fleet\Policies\VehicleAllocationPolicy;
use Modules\Notifications\Listeners\SendBookingDecisionNotification;
use Modules\Notifications\Listeners\SendReportExportReadyNotification;
use Modules\Reports\Enums\ReportType;
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
        Gate::policy(OrderRequest::class, OrderRequestPolicy::class);
        Gate::policy(RateCard::class, RateCardPolicy::class);
        Gate::policy(Invoice::class, InvoicePolicy::class);
        Gate::policy(User::class, UserPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
        Gate::policy(VehicleAllocation::class, VehicleAllocationPolicy::class);

        // A Gate rather than a Policy: reports are not a model, and
        // AGENTS.md's authorization rule names Gates alongside Policies.
        // Drivers and Corporate Employees do not hold `reports.view` — a
        // report spans the whole tenant's fleet, which is more than either
        // should see.
        Gate::define('viewReports', fn (User $user) => $user->hasPermission(Permission::REPORTS_VIEW));

        // Per-report, because "may run a report" and "may see this report's
        // data" are different questions. `viewReports` above answers only
        // the first, and gating all four reports on it alone meant a
        // Dispatcher — refused /invoices — could read and export a client's
        // invoiced, credited and outstanding totals. See
        // ReportType::permissions().
        Gate::define('viewReport', fn (User $user, ReportType $report) => $report->isReadableBy($user));

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
        // FQCNs, so moving a class later cannot orphan the audit rows that
        // reference it.
        //
        // **Every Auditable model must appear here.** The map is *enforced*,
        // which means a missing entry does not fall back to the FQCN — it
        // throws ClassMorphViolationException from getMorphClass(). Since
        // Auditable records on `created`, an unmapped model cannot be
        // created at all. VehicleAllocation was missing and was exactly
        // that: ADR-0005 shipped the table, and every insert into it threw.
        // `AuditableModelsHaveMorphAliasTest` now asserts the pair.
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
            // ADR-0004. AGENTS.md requires an audit trail over
            // "roles/permissions"; since this pass that is literally this
            // model, and its JSON permissions column is what makes the
            // before/after diff readable.
            'role' => Role::class,
            // ADR-0005's "vehicles supplied to the Bank" — a contract, not
            // ownership. Audited because it is the record of what a client
            // was promised.
            'vehicle_allocation' => VehicleAllocation::class,
            // ADR-0012's walk-in queue. Registered the moment the model
            // became Auditable — AuditableModelsHaveMorphAliasTest fails
            // the build for any Auditable model this map omits, because
            // creating one would throw from AuditLog::record().
            'order_request' => OrderRequest::class,
            // ADR-0013's customer principal. Not Auditable — it is here
            // because Sanctum's personal_access_tokens.tokenable_type is a
            // morph, and an enforced map with no entry throws the moment a
            // customer token is minted.
            'customer' => Customer::class,
        ]);
    }
}
