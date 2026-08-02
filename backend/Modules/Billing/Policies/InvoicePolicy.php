<?php

namespace Modules\Billing\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Billing\Models\Invoice;

/**
 * Issuing an invoice, and crediting one back, are the two acts in this
 * platform that decide what a client owes. Both need `invoices.create` /
 * `invoices.credit`, seeded onto Super Admin and Finance only — AGENTS.md's
 * "roles [that] can move money and change rates".
 *
 * A Dispatcher can drive a trip all the way to Trip Completed and cannot
 * bill it. That is deliberate: the person who records what happened should
 * not be the person who prices it.
 *
 * Reading is wider. An Operations Manager and a Corporate Admin both need
 * to see what was billed, and ADR-0001's TenantScope confines that to their
 * own tenant. Drivers and Corporate Employees hold neither grant: a driver
 * has no business knowing the client's contracted rates.
 *
 * Permission-based since ADR-0004. The two role constants that used to sit
 * here were duplicated verbatim in RateCardPolicy; that drift is what the
 * catalogue removes.
 */
class InvoicePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::INVOICES_VIEW);
    }

    public function view(User $user, Invoice $invoice): bool
    {
        return $this->viewAny($user);
    }

    /** Generating the invoice for a completed trip. */
    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::INVOICES_CREATE);
    }

    /**
     * Issuing a credit note against this invoice. Not `update` — nothing
     * updates an invoice, and naming it so would suggest otherwise.
     *
     * Its own permission rather than sharing `invoices.create`, because
     * they are different acts: one bills, the other gives money back, and a
     * role that may do one and not the other is now expressible.
     */
    public function credit(User $user, Invoice $invoice): bool
    {
        return $user->hasPermission(Permission::INVOICES_CREDIT);
    }
}
