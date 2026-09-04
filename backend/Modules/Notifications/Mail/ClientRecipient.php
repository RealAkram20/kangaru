<?php

namespace Modules\Notifications\Mail;

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\OperatorClient;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Notification;
use Modules\Notifications\Notifications\ClientEventNotification;

/**
 * Who at a client actually receives a given email, and where it goes.
 *
 * ## One place, because a recipient list is the easiest thing to get wrong
 *
 * The mail plan §6 rule is that an email about a fleet's operations goes to
 * that fleet and to nobody else, and the client half of that has its own trap:
 * **a client has two audiences and they are different people.**
 *
 * - **Operations** — a booking decision, a driver assigned, a trip finished.
 *   Goes to the account that raised it, or to the client's administrators.
 * - **Finance** — an invoice, a credit note. Goes to
 *   `operator_clients.billing_email`.
 *
 * Sending an invoice to a transport officer is how it goes unpaid: they have
 * no purchase-order process and no reason to forward what reads as a receipt
 * for a trip they already took. Sending a booking decision to accounts payable
 * is the same mistake pointed the other way.
 *
 * ## The billing address may have no account
 *
 * `billing_email` is a free-text column on the contract, filled in at
 * onboarding, and there is frequently no `users` row behind it. That is the
 * normal case rather than an edge one, and it is why this routes through
 * `Notification::route()` and why `SettingsMailChannel` accepts an
 * `AnonymousNotifiable`.
 *
 * ## Falling back rather than failing
 *
 * No billing address means the client's administrators get it. An invoice
 * received by the wrong colleague is recoverable; an invoice received by
 * nobody is a debt the client does not know about and a conversation somebody
 * has to have in a month.
 */
class ClientRecipient
{
    /**
     * Sends a finance email for this contract, to the right address.
     *
     * @param  callable(?string): ClientEventNotification  $build  Receives the resolved address, or null.
     */
    public function finance(OperatorClient $contract, callable $build): void
    {
        $billing = trim((string) $contract->billing_email);

        if ($billing !== '') {
            Notification::route('mail', $billing)->notify($build($billing));

            return;
        }

        foreach ($this->administrators($contract->tenant_id) as $admin) {
            $admin->notify($build(null));
        }
    }

    /**
     * Sends an operations email to the client's administrators.
     *
     * Administrators rather than every account: a corporate employee raises
     * bookings and does not need to hear about the company's contracts. The
     * employee-facing messages are addressed to the individual who acted, by
     * the services that already know who that was.
     */
    public function operations(OperatorClient $contract, callable $build): void
    {
        foreach ($this->administrators($contract->tenant_id) as $admin) {
            $admin->notify($build(null));
        }
    }

    /**
     * @return Collection<int, User>
     */
    private function administrators(?int $tenantId): Collection
    {
        if ($tenantId === null) {
            return collect();
        }

        /*
         * `withoutGlobalScopes()`, and it needs saying.
         *
         * This runs from a queue worker and from head office's own console,
         * neither of which has the client's tenant bound — `TenantScope` would
         * fail closed and return nobody, which for a notification means
         * silence rather than an error.
         *
         * The `where` on `tenant_id` immediately below is what keeps that
         * safe: the scope is dropped and the same constraint is applied
         * explicitly, to one named tenant, for a read that returns only
         * addresses this email is already about.
         */
        return User::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('access_level', AccessLevel::CLIENT->value)
            ->where('role', UserRole::CORPORATE_ADMIN->value)
            ->get();
    }
}
