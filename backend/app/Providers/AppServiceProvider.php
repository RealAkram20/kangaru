<?php

namespace App\Providers;

use App\Enums\Permission;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Modules\Administration\Models\Role;
use Modules\Administration\Models\Setting;
use Modules\Administration\Policies\AuditLogPolicy;
use Modules\Administration\Policies\RolePolicy;
use Modules\Administration\Policies\SettingPolicy;
use Modules\Administration\Policies\UserPolicy;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Listeners\SettleWalkInFare;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Models\RateCardZoneRate;
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
use Modules\Customers\Policies\CustomerPolicy;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Listeners\CreditDriverForCompletedTrip;
use Modules\Drivers\Listeners\QualifyReferralForCompletedTrip;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Policies\DriverApplicationPolicy;
use Modules\Drivers\Policies\DriverDocumentPolicy;
use Modules\Drivers\Policies\DriverPolicy;
use Modules\Drivers\Policies\DriverSettlementRequestPolicy;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Fleet\Models\Zone;
use Modules\Fleet\Policies\AvailabilityBlockPolicy;
use Modules\Fleet\Policies\VehicleAllocationPolicy;
use Modules\Fleet\Policies\ZonePolicy;
use Modules\Fleet\Support\DatabaseDriverPresenceStore;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Fleet\Support\RedisDriverPresenceStore;
use Modules\Notifications\Listeners\SendBookingDecisionNotification;
use Modules\Notifications\Listeners\SendReportExportReadyNotification;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Events\ReportExportCompleted;
use Modules\Trips\Events\TripCompleted;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripRating;
use Modules\Trips\Policies\TripPolicy;
use Modules\Trips\Routing\GoogleDirectionsProvider;
use Modules\Trips\Routing\OsrmProvider;
use Modules\Trips\Routing\RouteProvider;
use Modules\Trips\Support\ContactChannel;
use Modules\Trips\Support\DatabaseLivePositionStore;
use Modules\Trips\Support\DirectContactChannel;
use Modules\Trips\Support\LivePositionStore;
use Modules\Trips\Support\RedisLivePositionStore;
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

        // ADR-0024 §7: how the driver and the passenger reach each other.
        //
        // Bound rather than instantiated at the call sites so that adopting
        // a masking provider — Twilio, Africa's Talking — is one line here
        // and nothing else. Without the seam, adding masking later means
        // finding every place a number is rendered, which is exactly when
        // one gets missed.
        $this->app->bind(ContactChannel::class, DirectContactChannel::class);

        // The routing vendor, behind the seam ADR-0031 §2 keeps for it. One
        // implementation today; the settings group records which engine drew
        // a route so "why does this line look wrong" has an answer.
        $this->app->bind(RouteProvider::class, function ($app) {
            // Resolved per call rather than pinned at boot: the provider is a
            // setting, and an operator switching it in System Settings must
            // take effect on the next request rather than the next deploy.
            //
            // A boot-time read would also make `php artisan migrate` on an
            // empty database depend on the settings table it is about to
            // create — the trap ADR-0014's `mail` note records.
            $provider = $app->make(SettingsService::class)->get('maps', 'routing_provider');

            return $provider === 'google'
                ? $app->make(GoogleDirectionsProvider::class)
                : $app->make(OsrmProvider::class);
        });
    }

    /**
     * Bootstrap any application services.
     */
    /**
     * ADR-0019: which store answers "where is the fleet right now".
     *
     * Bound by config rather than by environment sniffing, so a deployment
     * that has Redis says so once in `.env` and every caller follows —
     * nothing in the codebase asks whether Redis exists.
     */
    private function bindLivePositionStore(): void
    {
        $this->app->bind(LivePositionStore::class, fn () => match (config('tracking.live_positions_driver')) {
            'redis' => new RedisLivePositionStore,
            default => new DatabaseLivePositionStore,
        });
    }

    /**
     * ADR-0024 §2: which store answers "who is on duty and where".
     *
     * A sibling of `bindLivePositionStore()` and bound the same way, but a
     * *separate* setting rather than sharing `tracking.live_positions_driver`.
     * The two answer different questions with different freshness budgets —
     * a map a human watches versus a battery budget on a handset — and a
     * deployment could sensibly want Redis for one and not the other.
     */
    private function bindDriverPresenceStore(): void
    {
        $this->app->bind(DriverPresenceStore::class, fn () => match (config('dispatch.presence_driver')) {
            'redis' => new RedisDriverPresenceStore,
            default => new DatabaseDriverPresenceStore,
        });
    }

    public function boot(): void
    {
        $this->bindLivePositionStore();
        $this->bindDriverPresenceStore();

        // ADR-0012 promised the public order throttle would "move by
        // config, not by removing the throttle"; ADR-0014 phase 2 is that
        // config. Resolved per request through the settings cache, so a
        // saved change applies to the very next request — floored at 1 so
        // no stored value can accidentally disable the limiter outright.
        RateLimiter::for('public-orders', function (Request $request) {
            $perMinute = (int) app(SettingsService::class)->get('ordering', 'rate_limit_per_minute');

            return Limit::perMinute(max(1, $perMinute))->by($request->ip());
        });

        // Explicit registration rather than relying on Laravel's naming-
        // convention policy guesser across the Modules\ namespace.
        Gate::policy(Company::class, CompanyPolicy::class);
        Gate::policy(AuditLog::class, AuditLogPolicy::class);
        Gate::policy(Vehicle::class, VehiclePolicy::class);
        Gate::policy(Driver::class, DriverPolicy::class);
        Gate::policy(DriverApplication::class, DriverApplicationPolicy::class);
        Gate::policy(DriverSettlementRequest::class, DriverSettlementRequestPolicy::class);
        Gate::policy(DriverDocument::class, DriverDocumentPolicy::class);
        Gate::policy(Trip::class, TripPolicy::class);
        Gate::policy(Booking::class, BookingPolicy::class);
        Gate::policy(OrderRequest::class, OrderRequestPolicy::class);
        Gate::policy(RateCard::class, RateCardPolicy::class);
        Gate::policy(Invoice::class, InvoicePolicy::class);
        Gate::policy(User::class, UserPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
        Gate::policy(Setting::class, SettingPolicy::class);
        Gate::policy(VehicleAllocation::class, VehicleAllocationPolicy::class);
        Gate::policy(AvailabilityBlock::class, AvailabilityBlockPolicy::class);
        Gate::policy(Customer::class, CustomerPolicy::class);
        Gate::policy(Zone::class, ZonePolicy::class);

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
        // ADR-0026 §3: a walk-in ride is priced the moment it finishes.
        // Registered here for the same reason the booking listeners are —
        // Laravel's event discovery scans app/Listeners by convention and
        // would never look under Modules\.
        Event::listen(TripCompleted::class, SettleWalkInFare::class);
        // **After** SettleWalkInFare, and the order is load-bearing: the
        // fare does not exist until that listener has priced the trip, and
        // the ledger pair is idempotent so a premature run would credit
        // nothing and never retry (ADR-0029 §2).
        Event::listen(TripCompleted::class, CreditDriverForCompletedTrip::class);
        // ADR-0037 §4. Order-independent, unlike the two above: this reads
        // `trips`, not a fare, and it credits a *different* driver — the one
        // who introduced the person who just finished a job.
        Event::listen(TripCompleted::class, QualifyReferralForCompletedTrip::class);

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
            // ADR-0027's applications queue. Approving one mints a principal
            // and rejecting one ends somebody's application — both are
            // decisions the office may be asked to account for.
            'driver_application' => DriverApplication::class,
            // ADR-0029's ledger. Every entry is money owed to or by a person,
            // and a correction is a new row rather than an edit — so the audit
            // trail and the ledger tell the same story from two directions.
            'driver_ledger_entry' => DriverLedgerEntry::class,
            // ADR-0032. The first surface where a staff action directly
            // changes what a driver is owed — confirming one writes a
            // settlement into the ledger — so who answered it, and when, is
            // the point rather than a formality.
            'driver_settlement_request' => DriverSettlementRequest::class,
            // ADR-0033. Verifying somebody's licence is a compliance act, and
            // the first staff decision on this platform about a legal
            // document — who looked, when, and from which IP is the point.
            'driver_document' => DriverDocument::class,
            'trip' => Trip::class,
            // ADR-0030. A rating cannot be edited or withdrawn, so the only
            // mutation an audit trail will ever see here is an administrator
            // deleting one — which is exactly the act worth recording.
            'trip_rating' => TripRating::class,
            'booking' => Booking::class,
            'rate_card' => RateCard::class,
            'rate_card_version' => RateCardVersion::class,
            'rate_card_rate' => RateCardRate::class,
            // ADR-0021's billing half. A zone rate decides what a client is
            // charged for a trip picked up inside a boundary, so it is a
            // rate-card change like any other and audited as one.
            'rate_card_zone_rate' => RateCardZoneRate::class,
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
            // ADR-0017's availability calendar. Audited because taking a
            // driver or a vehicle off the road — and answering a driver's
            // request for time off — is a decision somebody made and may
            // later be asked about.
            'availability_block' => AvailabilityBlock::class,
            'zone' => Zone::class,
            'driver_shift_window' => DriverShiftWindow::class,
            // ADR-0013's customer principal. Not Auditable — it is here
            // because Sanctum's personal_access_tokens.tokenable_type is a
            // morph, and an enforced map with no entry throws the moment a
            // customer token is minted.
            'customer' => Customer::class,
            // ADR-0014: settings changes are audited like rate cards and
            // roles — an operational lever silently flipped is the audit
            // trail's business.
            'setting' => Setting::class,
            // ADR-0024's automatic dispatch. Audited because an offer is the
            // record of a decision the *platform* made about a person — who
            // was asked, in what order, and what they said — and "why did it
            // pick him" has to stay answerable next week, when the fleet has
            // moved. It is also the acceptance-rate data
            // `Modules/Drivers/README.md` lists as missing.
            'dispatch_offer' => DispatchOffer::class,
        ]);
    }
}
