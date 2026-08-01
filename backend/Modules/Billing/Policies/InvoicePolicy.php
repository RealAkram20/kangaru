<?php

namespace Modules\Billing\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Billing\Models\Invoice;

/**
 * Issuing an invoice, and crediting one back, are the two acts in this
 * platform that decide what a client owes. Both are confined to Super Admin
 * and Finance — AGENTS.md's "roles [that] can move money and change rates".
 *
 * A Dispatcher can drive a trip all the way to Trip Completed and cannot
 * bill it. That is deliberate: the person who records what happened should
 * not be the person who prices it.
 *
 * Reading is wider. An Operations Manager and a Corporate Admin both need
 * to see what was billed, and ADR-0001's TenantScope confines that to their
 * own tenant. Drivers and Corporate Employees see nothing here: a driver
 * has no business knowing the client's contracted rates.
 */
class InvoicePolicy
{
    private const BILLERS = [
        UserRole::SUPER_ADMIN,
        UserRole::FINANCE,
    ];

    private const READERS = [
        UserRole::SUPER_ADMIN,
        UserRole::FINANCE,
        UserRole::OPERATIONS_MANAGER,
        UserRole::CORPORATE_ADMIN,
    ];

    public function viewAny(User $user): bool
    {
        return in_array($user->role, self::READERS, true);
    }

    public function view(User $user, Invoice $invoice): bool
    {
        return $this->viewAny($user);
    }

    /** Generating the invoice for a completed trip. */
    public function create(User $user): bool
    {
        return in_array($user->role, self::BILLERS, true);
    }

    /**
     * Issuing a credit note against this invoice. Not `update` — nothing
     * updates an invoice, and naming it so would suggest otherwise.
     */
    public function credit(User $user, Invoice $invoice): bool
    {
        return in_array($user->role, self::BILLERS, true);
    }
}
