<?php

namespace App\Enums;

/**
 * Every ability the platform gates on (ADR-0004).
 *
 * The catalogue lives in code, not in the database. A permission only means
 * something because a policy checks it, so one invented in a table would
 * grant nothing — a role that appears to confer an ability and does not is
 * worse than a missing one.
 *
 * Values are `subject.verb`, or `subject.verb.scope` where the same verb
 * exists for your own records and for everybody's. That pairing is how the
 * old role comparisons survive the move: "a Corporate Employee sees their
 * own bookings" was identity in the policy and is `bookings.view.all`
 * being **absent** here.
 *
 * Never repurpose a case. `roles.permissions` stores these strings, and a
 * reused value silently re-points every role that held it.
 */
enum Permission: string
{
    // ── Administration ────────────────────────────────────────────────
    case AUDIT_VIEW = 'audit.view';
    case STAFF_VIEW = 'staff.view';
    case STAFF_MANAGE = 'staff.manage';
    /** Creating and editing roles themselves. The keys to the building. */
    case ROLES_MANAGE = 'roles.manage';

    // ── Bookings ──────────────────────────────────────────────────────
    /** Absent = you see only the bookings you raised. */
    case BOOKINGS_VIEW_ALL = 'bookings.view.all';
    case BOOKINGS_CREATE = 'bookings.create';
    case BOOKINGS_APPROVE = 'bookings.approve';
    /** Absent = you may still cancel your own. */
    case BOOKINGS_CANCEL_ANY = 'bookings.cancel.any';
    case BOOKINGS_DISPATCH = 'bookings.dispatch';

    // ── Trips ─────────────────────────────────────────────────────────
    /** Absent = own trips only: assigned to you, or arising from your bookings. */
    case TRIPS_VIEW_ALL = 'trips.view.all';
    case TRIPS_CREATE = 'trips.create';
    /** Move a trip through any legal transition. */
    case TRIPS_TRANSITION_ANY = 'trips.transition.any';
    /** The driver's own journey states, on a trip assigned to you. */
    case TRIPS_TRANSITION_OWN = 'trips.transition.own';
    /** Disputed and Closed only — the finance end of the lifecycle. */
    case TRIPS_TRANSITION_FINANCE = 'trips.transition.finance';
    case TRIPS_LOCATIONS_RECORD = 'trips.locations.record';

    // ── Billing ───────────────────────────────────────────────────────
    case INVOICES_VIEW = 'invoices.view';
    case INVOICES_CREATE = 'invoices.create';
    case INVOICES_CREDIT = 'invoices.credit';
    case RATECARDS_VIEW = 'ratecards.view';
    case RATECARDS_MANAGE = 'ratecards.manage';

    // ── Clients ───────────────────────────────────────────────────────
    case COMPANIES_VIEW = 'companies.view';
    case COMPANIES_CREATE = 'companies.create';
    case COMPANIES_UPDATE = 'companies.update';
    case COMPANIES_DELETE = 'companies.delete';

    // ── Fleet ─────────────────────────────────────────────────────────
    case VEHICLES_VIEW = 'vehicles.view';
    case VEHICLES_MANAGE = 'vehicles.manage';
    case DRIVERS_VIEW = 'drivers.view';
    case DRIVERS_MANAGE = 'drivers.manage';
    /**
     * Seeing which vehicles are contracted to whom (ADR-0009). Separate from
     * `vehicles.view` because it is a different question: the fleet is
     * Shanitah's and everyone may read it, while an allocation is a client's
     * commercial arrangement and is not everyone's business.
     */
    case ALLOCATIONS_VIEW = 'allocations.view';
    /** Agreeing and ending a contract — a commercial act, not an operational one. */
    case ALLOCATIONS_MANAGE = 'allocations.manage';

    // ── Reports ───────────────────────────────────────────────────────
    case REPORTS_VIEW = 'reports.view';

    /**
     * The heading a permission sits under in the role editor. Derived from
     * the value's first segment so a new permission is grouped without
     * anybody remembering to add it to a list.
     */
    public function group(): string
    {
        return match (explode('.', $this->value)[0]) {
            'audit', 'staff', 'roles' => 'Administration',
            'bookings' => 'Bookings',
            'trips' => 'Trips',
            'invoices', 'ratecards' => 'Billing',
            'companies' => 'Clients',
            'vehicles', 'drivers', 'allocations' => 'Fleet',
            'reports' => 'Reports',
            default => 'Other',
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::AUDIT_VIEW => 'Read the audit log',
            self::STAFF_VIEW => 'See the staff list',
            self::STAFF_MANAGE => 'Add, edit and suspend staff',
            self::ROLES_MANAGE => 'Create and edit roles',
            self::BOOKINGS_VIEW_ALL => "See everyone's bookings",
            self::BOOKINGS_CREATE => 'Raise a booking',
            self::BOOKINGS_APPROVE => 'Approve or reject a booking',
            self::BOOKINGS_CANCEL_ANY => "Cancel anyone's booking",
            self::BOOKINGS_DISPATCH => 'Assign a vehicle and driver',
            self::TRIPS_VIEW_ALL => 'See every trip',
            self::TRIPS_CREATE => 'Raise a trip directly',
            self::TRIPS_TRANSITION_ANY => 'Move any trip through its lifecycle',
            self::TRIPS_TRANSITION_OWN => 'Update a trip assigned to you',
            self::TRIPS_TRANSITION_FINANCE => 'Dispute and close a trip',
            self::TRIPS_LOCATIONS_RECORD => 'Record GPS positions',
            self::INVOICES_VIEW => 'See invoices',
            self::INVOICES_CREATE => 'Issue an invoice',
            self::INVOICES_CREDIT => 'Issue a credit note',
            self::RATECARDS_VIEW => 'See rate cards',
            self::RATECARDS_MANAGE => 'Create rate cards and versions',
            self::COMPANIES_VIEW => 'See client companies',
            self::COMPANIES_CREATE => 'Onboard a client company',
            self::COMPANIES_UPDATE => 'Edit a client company',
            self::COMPANIES_DELETE => 'Remove a client company',
            self::VEHICLES_VIEW => 'See the fleet',
            self::VEHICLES_MANAGE => 'Add and edit vehicles',
            self::DRIVERS_VIEW => 'See drivers',
            self::DRIVERS_MANAGE => 'Add and edit drivers',
            self::ALLOCATIONS_VIEW => 'See which vehicles are contracted to whom',
            self::ALLOCATIONS_MANAGE => 'Agree and end a vehicle allocation',
            self::REPORTS_VIEW => 'Run and export reports',
        };
    }

    /**
     * Everything, for seeding the Super Admin role.
     *
     * @return array<int, string>
     */
    public static function allValues(): array
    {
        return array_map(fn (self $case) => $case->value, self::cases());
    }
}
