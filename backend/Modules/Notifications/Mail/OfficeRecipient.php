<?php

namespace Modules\Notifications\Mail;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Which office staff hear about something, and the line that must not move.
 *
 * ## The rule
 *
 * **An email about a fleet's operations goes to that fleet and to nobody
 * else.** Not to head office, and never to a second fleet.
 *
 * ADR-0062 draws that line for reads and ADR-0055 §2 makes it the model's
 * whole point. A recipient list is the easiest place in this codebase to cross
 * it, because a leak here does not look like a bug — it looks like a helpful
 * CC, and it is one line of code.
 *
 * This class is the only place that resolves office recipients, so the guard
 * is written once and tested once instead of being re-derived at fifteen send
 * sites where one of them will eventually get it subtly wrong. That is
 * kangaru-c0's finding stated as a design rule: **a guard is only as deployed
 * as its call sites**, so the way to keep it deployed is to have one.
 *
 * ## Addressed by permission, not by role
 *
 * A settlement request goes to whoever may answer it, which is whoever holds
 * `drivers.manage`, and since ADR-0004 that is data rather than a fixed list
 * of roles. Addressing by role would mean a deployment that made a custom
 * "Depot Supervisor" role gets a queue nobody is told about.
 *
 * The permission asked for is the one that lets the reader **act** on the
 * message. An email to somebody who cannot do the thing it describes is worse
 * than no email: they cannot help, and they learn to ignore the sender.
 */
class OfficeRecipient
{
    /**
     * The staff at one fleet who hold this permission.
     *
     * @return Collection<int, User>
     */
    public function fleet(?int $operatorId, Permission $permission): Collection
    {
        if ($operatorId === null) {
            return collect();
        }

        return $this->active()
            ->where('access_level', AccessLevel::FLEET->value)
            // **The line.** Without this `where`, every alert about one
            // fleet's drivers reaches every other fleet's office, and each
            // message names a driver, a trip or a vehicle belonging to a
            // competitor.
            ->where('operator_id', $operatorId)
            ->get()
            ->filter(fn (User $user) => $this->mayAct($user, $permission))
            ->values();
    }

    /**
     * Head office staff who hold this permission.
     *
     * @return Collection<int, User>
     */
    public function headOffice(Permission $permission): Collection
    {
        return $this->active()
            ->where('access_level', AccessLevel::KANGARU->value)
            ->get()
            ->filter(fn (User $user) => $this->mayAct($user, $permission))
            ->values();
    }

    /**
     * Whether this person can actually do the thing the email describes.
     *
     * Permission, not role: since ADR-0004 a role is data, so addressing a
     * fixed list of roles would mean a deployment that made a custom "Depot
     * Supervisor" gets a queue nobody is told about.
     *
     * Drivers are excluded outright. They hold no office permission today, but
     * a role is data and a deployment could grant one, and an operational
     * alert addressed to the driver it is about is an odd and occasionally
     * revealing message.
     */
    private function mayAct(User $user, Permission $permission): bool
    {
        return $user->role !== UserRole::DRIVER && $user->hasPermission($permission);
    }

    /**
     * @return Builder<User>
     */
    private function active(): Builder
    {
        /*
         * `withoutGlobalScopes()`, deliberately, and the `where` clauses in
         * both callers are what keep it safe.
         *
         * These sends happen from queue workers and from console commands,
         * neither of which passes through `IdentifyTenant`. `TenantScope`
         * would fail closed and return nobody, which for a notification is
         * silence rather than an error — the worst possible failure mode for
         * an alert, because nothing anywhere would say it had happened.
         *
         * So the scope is dropped and the narrowing is applied explicitly, by
         * access level and by named operator, on every path out of this class.
         * There is no method here that skips it.
         *
         * The permission filter runs in PHP rather than SQL because
         * `hasPermission()` resolves through the role row and its grants. An
         * office is tens of people, not thousands.
         */
        return User::query()
            ->withoutGlobalScopes()
            ->where('status', UserStatus::ACTIVE->value)
            ->whereNotNull('email');
    }
}
