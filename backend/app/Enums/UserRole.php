<?php

namespace App\Enums;

/**
 * The 10 Phase 1 user roles from PROJECT.md. Super Admin and Operations
 * Manager are platform-level (tenant_id null); all others belong to a
 * tenant.
 */
enum UserRole: string
{
    case SUPER_ADMIN = 'super_admin';
    case OPERATIONS_MANAGER = 'operations_manager';
    case DISPATCHER = 'dispatcher';
    case FINANCE = 'finance';
    case FLEET_OWNER = 'fleet_owner';
    case BRANCH_MANAGER = 'branch_manager';
    case DEPOT_MANAGER = 'depot_manager';
    case CORPORATE_ADMIN = 'corporate_admin';
    case CORPORATE_EMPLOYEE = 'corporate_employee';
    case DRIVER = 'driver';

    /**
     * PROJECT.md's own wording for each role, so a staff list and the
     * product brief name the same thing the same way. Used in role pickers
     * and wherever a role is shown to a person rather than matched in code.
     */
    public function label(): string
    {
        return match ($this) {
            self::SUPER_ADMIN => 'Super Admin',
            self::OPERATIONS_MANAGER => 'Operations Manager',
            self::DISPATCHER => 'Dispatcher',
            self::FINANCE => 'Finance',
            self::FLEET_OWNER => 'Fleet Owner',
            self::BRANCH_MANAGER => 'Branch Manager',
            self::DEPOT_MANAGER => 'Depot Manager',
            self::CORPORATE_ADMIN => 'Corporate Admin',
            self::CORPORATE_EMPLOYEE => 'Corporate Employee',
            self::DRIVER => 'Driver',
        };
    }

    /**
     * Whether the role exists above any single tenant. Both may hold a null
     * `tenant_id`; everyone else must belong somewhere.
     *
     * Deliberately NOT named `isPlatformLevel()`: that name belongs to
     * `User::isPlatformLevel()`, which answers a different question —
     * whether an *account* actually has `tenant_id === null`, which is what
     * every policy and scope keys on (ADR-0006). A platform-capable role can
     * still be seeded inside a tenant, and a policy that reached for the
     * role's answer instead of the account's would silently widen or narrow
     * access. Two methods with one name and two meanings is the drift
     * ADR-0004 exists to prevent, so the role-shaped question carries a
     * role-shaped name.
     */
    public function isPlatformRole(): bool
    {
        return $this === self::SUPER_ADMIN || $this === self::OPERATIONS_MANAGER;
    }
}
