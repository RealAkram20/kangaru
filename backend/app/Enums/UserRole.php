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
}
