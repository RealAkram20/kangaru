<?php

namespace Modules\Administration\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\OperatorClient;
use App\Models\User;
use Modules\Administration\Models\Role;

/**
 * Who may administer accounts, and which roles they may hand out.
 *
 * Permission-based since ADR-0004: `staff.view` and `staff.manage` replace
 * the two-role constant, so a custom "HR" role can onboard staff without
 * also gaining the audit log.
 *
 * ## The escalation rule
 *
 * **Nobody may grant a permission they do not themselves hold.**
 *
 * This generalises the old special case — only a Super Admin may appoint a
 * Super Admin — and closes the hole that special case did not cover. Once
 * roles are data, a Corporate Admin could otherwise define or pick a custom
 * role carrying `roles.manage`, assign it to an account they control, and
 * reach platform administration through a side door without ever touching
 * the Super Admin slug.
 *
 * ## Acting on yourself
 *
 * You may not change your own role or suspend your own account. Suspending
 * yourself locks the tenant's last administrator out with no way back in;
 * changing your own role is self-promotion with extra steps.
 */
class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::STAFF_VIEW);
    }

    /**
     * Everybody sees the staff of their own organisation, and a fleet also
     * sees the staff of the clients it serves. Nobody sees across.
     *
     * The organisation check lives here as well as in the controller's query.
     * `User` deliberately has no BelongsToTenant — login must find an account
     * before any organisation is known — so nothing scopes these reads
     * automatically, and this policy is the whole of what stands between a
     * resolved id and somebody else's names, emails and phone numbers.
     */
    public function view(User $user, User $subject): bool
    {
        if (! $this->viewAny($user)) {
            return false;
        }

        return $this->sharesOrganisation($user, $subject);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::STAFF_MANAGE);
    }

    public function update(User $user, User $subject): bool
    {
        return $this->create($user) && $this->sharesOrganisation($user, $subject);
    }

    /**
     * Suspension and reactivation, which are the same permission: a role
     * that can take access away must be able to give it back, or a mistake
     * needs a database console to undo.
     */
    public function suspend(User $user, User $subject): bool
    {
        return $this->update($user, $subject) && $user->id !== $subject->id;
    }

    /**
     * Whether `$user` may put someone into `$role` — the subset rule above.
     *
     * Called for both creation and role changes, so it cannot be satisfied
     * by creating a user in a safe role and promoting them a second later.
     *
     * A slug with no matching row grants nothing and is refused rather than
     * treated as empty: assigning a role that does not exist would leave an
     * account holding no permissions for reasons nobody could see.
     */
    public function assignRole(User $user, ?Role $role): bool
    {
        if (! $this->create($user) || $role === null) {
            return false;
        }

        return $user->holdsAll($role->permissions ?? []);
    }

    /**
     * Whether `$user` may administer `$subject` at all — the organisation
     * boundary, asked once and answered the same way the listing answers it.
     *
     * ## What this used to be, and why it was wrong
     *
     * It read:
     *
     *     if ($user->isPlatformLevel()) { return true; }
     *     return $user->tenant_id === $subject->tenant_id;
     *
     * ADR-0006 wrote that when *platform-level* meant Shanitah and Shanitah
     * was the platform, so "administers everyone" was a true description of
     * head office. ADR-0055 split the axes and `isPlatformLevel()` became
     * `access_level === FLEET` — at which point the same line meant **every
     * fleet administers everyone**, which nobody decided and nothing said.
     *
     * `User::scopeForActor()` was narrowed for exactly this on 23 August, when
     * the second fleet was onboarded. This was not, and it is the only guard
     * standing after route-model binding: `User` carries no global scope
     * (login has to find an account by email before any organisation is
     * known), so `GET|PATCH /users/{user}` resolves any id in the table and
     * arrives here. A rival fleet's owner, a rival fleet's drivers, and every
     * client's staff were all reachable one id at a time.
     *
     * The listing and the record now answer the same question, deliberately:
     * a policy that is more generous than the scope beside it is a hole that
     * no listing test can see.
     *
     * ## The rule
     *
     * A fleet reaches its own people, plus the people of the clients it
     * **actively** serves — `servedBy` is active contracts only, so a fleet
     * that has merely asked to serve a client reaches nobody there (ADR-0060
     * §4: asking grants no read, and it grants no write either).
     *
     * Head office reaches head office. Reaching into a fleet is ADR-0056's
     * act-as, which arrives as a person at that fleet and is scoped as them —
     * announced, time-boxed and in the audit trail, which a cross-fleet
     * `SELECT` is not.
     *
     * An applicant administers nobody, including themselves: their reach is
     * keyed off their own application id and nothing here (ADR-0055,
     * amendment).
     */
    private function sharesOrganisation(User $user, User $subject): bool
    {
        return match ($user->access_level) {
            AccessLevel::FLEET => $subject->operator_id === $user->operator_id
                || ($subject->tenant_id !== null && $this->serves($user, $subject)),
            AccessLevel::KANGARU => $subject->access_level === AccessLevel::KANGARU,
            // A null on either side never matches, so a client administrator
            // can never reach a fleet or a head-office account. The database
            // makes the dangerous half of that unstorable anyway — a `client`
            // row without a client is refused by
            // `users_access_level_matches_columns`.
            AccessLevel::CLIENT => $user->tenant_id !== null
                && $user->tenant_id === $subject->tenant_id,
            AccessLevel::APPLICANT => false,
        };
    }

    /** Whether the actor's fleet holds a live contract with the subject's client. */
    private function serves(User $user, User $subject): bool
    {
        return OperatorClient::query()
            ->servedBy((int) $user->operator_id)
            ->where('tenant_id', $subject->tenant_id)
            ->exists();
    }
}
