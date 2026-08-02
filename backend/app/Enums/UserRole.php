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
     */
    public function isPlatformLevel(): bool
    {
        return $this === self::SUPER_ADMIN || $this === self::OPERATIONS_MANAGER;
    }
}
