<?php

namespace App\Enums;

/**
 * What a corporate client's administrator may switch on for one of their
 * own people, over and above that person's role.
 *
 * ## Why this exists beside roles
 *
 * Roles are platform-wide (ADR-0004): one catalogue, seeded by Shanitah,
 * read by every client. A bank cannot own a role — a "Centenary Branch
 * Approver" in the catalogue would be visible to every other client and
 * editable by none of them. What a client *can* own is a person's
 * switches: this officer approves bookings, that finance clerk sees the
 * invoices, nobody else does. Each capability is a fixed bundle of existing
 * permissions, unioned onto the role's set by `User::permissions()`, so
 * every policy keeps asking the one question it always asked and nothing
 * new has to be authorised.
 *
 * ## The escalation rule still holds
 *
 * A capability can only ever grant permissions the *granting* administrator
 * holds themselves (`UpdateUserRequest`, mirroring role assignment), and the
 * union only admits permissions named here — a `capabilities` column
 * carrying a slug this enum does not know, or a permission a bundle does
 * not include, grants nothing. Fails closed, like a role slug that matches
 * no row.
 *
 * ## The one that is not a permission
 *
 * "Books without approval" is not a bundle: it changes what happens to a
 * booking this person creates (`BookingService::create()` approves it on
 * their behalf), not what they may do to other people's bookings. It lives
 * on the user as its own flag, not here.
 *
 * Persisted as slugs on `users.capabilities`; never repurpose a case.
 */
enum ClientCapability: string
{
    /** Approve and reject the organisation's transport requests, and see all of them. */
    case APPROVES_BOOKINGS = 'approves_bookings';

    /** Read the organisation's invoices, and run and export its reports. */
    case SEES_FINANCE = 'sees_finance';

    /** Add, edit and suspend the organisation's own staff. */
    case MANAGES_STAFF = 'manages_staff';

    /**
     * Build the organisation's saved places and the routes made of them
     * (ADR-0045 §9).
     *
     * A switch rather than a role, for this enum's whole reason: the person
     * who knows which ATM is serviced in which order is an operations
     * officer, not necessarily the administrator, and the catalogue cannot
     * hold a "Centenary Route Planner".
     */
    case MANAGES_ROUTES = 'manages_routes';

    public function label(): string
    {
        return match ($this) {
            self::APPROVES_BOOKINGS => 'Approves bookings',
            self::SEES_FINANCE => 'Sees invoices and reports',
            self::MANAGES_STAFF => 'Manages staff',
            self::MANAGES_ROUTES => 'Builds routes',
        };
    }

    public function description(): string
    {
        return match ($this) {
            // One line each, and deliberately so: these are read four at a
            // time in a dialog that also collects a name, an email, a
            // number, a role and a roster. A paragraph per switch turned
            // the panel into the screen.
            self::APPROVES_BOOKINGS => "Approves anyone's requests, and sees every booking.",
            self::SEES_FINANCE => 'Opens invoices and runs reports.',
            self::MANAGES_STAFF => 'Adds colleagues and suspends accounts.',
            self::MANAGES_ROUTES => 'Pins locations and builds routes.',
        };
    }

    /**
     * The permissions this capability grants. Bundles are the smallest set
     * that makes the capability usable end to end — an approver who could
     * approve but not list the bookings would be a switch that does nothing.
     *
     * @return array<int, Permission>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::APPROVES_BOOKINGS => [
                Permission::BOOKINGS_APPROVE,
                Permission::BOOKINGS_VIEW_ALL,
                Permission::TRIPS_VIEW_ALL,
            ],
            self::SEES_FINANCE => [
                Permission::INVOICES_VIEW,
                Permission::REPORTS_VIEW,
            ],
            self::MANAGES_STAFF => [
                Permission::STAFF_VIEW,
                Permission::STAFF_MANAGE,
            ],
            // ROUTES_VIEW rides along for the reason APPROVES_BOOKINGS
            // carries BOOKINGS_VIEW_ALL: a builder who could not list what
            // they had built would be a switch that does nothing. It is
            // already on both corporate roles, so this is belt and braces
            // rather than an escalation.
            self::MANAGES_ROUTES => [
                Permission::ROUTES_VIEW,
                Permission::ROUTES_MANAGE,
            ],
        };
    }

    /**
     * Every permission any capability can grant — the ceiling of what this
     * mechanism can ever add to a role. Anything outside it stays a role's
     * business, and Shanitah's.
     *
     * @return array<int, string>
     */
    public static function grantable(): array
    {
        $all = [];
        foreach (self::cases() as $case) {
            foreach ($case->permissions() as $permission) {
                $all[$permission->value] = true;
            }
        }

        return array_keys($all);
    }

    /**
     * The catalogue a client's staff page offers, served so the screen never
     * holds its own copy of the labels or the list.
     *
     * @return array<int, array{slug: string, label: string, description: string}>
     */
    public static function catalogue(): array
    {
        return array_map(
            fn (self $case) => ['slug' => $case->value, 'label' => $case->label(), 'description' => $case->description()],
            self::cases(),
        );
    }
}
