<?php

namespace Modules\Drivers\Services;

use App\Enums\Permission;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;

/**
 * Giving a driver the account they sign in with — and taking it away.
 *
 * ## Why this is not a field on `PATCH /drivers/{driver}`
 *
 * Until ADR-0016 `drivers.user_id` existed, was read by `TripPolicy`, and
 * could be written by nothing but a seeder. A driver onboarded through the
 * API could not sign in, which meant they could not record the odometer
 * readings the Bank's acceptance criteria are made of. The obvious fix —
 * accept `user_id` in the driver form request — is the wrong one twice
 * over:
 *
 * 1. **It mints authority under the wrong permission.** Creating a login is
 *    creating a user. Folding it into `drivers.manage` would let a Depot
 *    Manager conjure accounts, side-stepping ADR-0004's escalation rule
 *    that nobody grants what they do not hold. So this asks for *both*
 *    `drivers.manage` (whose driver) and `UserPolicy::assignRole` (which
 *    role), and the second is checked against the actor's own permissions.
 * 2. **It hides a security event inside a profile edit.** Attaching or
 *    removing a login is worth its own audit entry and its own endpoint;
 *    buried in a PATCH that also changes a phone number, it reads as
 *    routine.
 *
 * ## Both halves of the link are exclusive
 *
 * One profile, one account. The database enforces it (unique index) and
 * this service refuses it before the database has to, so the caller gets a
 * sentence rather than an integrity violation.
 */
class DriverAccountService
{
    /**
     * Attaches a sign-in account to a driver, creating it when asked to.
     *
     * @param  array<string, mixed>  $attributes  already validated by StoreDriverAccountRequest
     *
     * @throws DriverAccountConflictException either half of the link is taken
     */
    public function open(Driver $driver, array $attributes): User
    {
        return DB::transaction(function () use ($driver, $attributes) {
            // Locked, not merely re-read: two administrators attaching an
            // account to the same profile at the same moment would both
            // pass a plain `user_id === null` check and the loser would hit
            // a raw integrity violation instead of this exception.
            $locked = Driver::query()->whereKey($driver->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->user_id !== null) {
                throw DriverAccountConflictException::profileAlreadyHasAccount($locked);
            }

            $account = array_key_exists('user_id', $attributes)
                ? $this->existingAccount((int) $attributes['user_id'])
                : $this->newAccount($locked, $attributes);

            $locked->user()->associate($account);
            $locked->save();

            return $account;
        });
    }

    /**
     * Detaches the account and revokes every token it holds.
     *
     * The revocation is the point. Detaching without it leaves a phone in a
     * cab signed in and still passing `TripPolicy::transition` until the
     * token's own 24-hour expiry — the same hole `UserAdminService::
     * revokeTokens` exists to close for suspension, and for the same
     * reason: authorisation that only takes effect at the next login is not
     * authorisation.
     *
     * The account itself survives. Removing somebody's login because they
     * changed vehicles would be a different and much larger act, and one an
     * audit trail cannot tell apart from deleting a colleague.
     */
    public function close(Driver $driver): ?User
    {
        return DB::transaction(function () use ($driver) {
            $locked = Driver::query()->whereKey($driver->getKey())->lockForUpdate()->firstOrFail();

            $account = $locked->user;

            if ($account === null) {
                return null;
            }

            $locked->user()->dissociate();
            $locked->save();

            $account->tokens()->delete();

            return $account;
        });
    }

    /**
     * Suspends the linked account when the driver profile is suspended.
     *
     * A driver marked `suspended` who can still sign in is only suspended
     * on paper: `TripPolicy::transition` asks whether the trip's driver is
     * the caller, never whether that driver is allowed to drive today.
     *
     * Deliberately one-way. Re-activating the profile does **not** restore
     * the account, because the account may have been suspended separately
     * by an administrator — for a lapsed visa, a disciplinary matter, a
     * suspected compromise — and quietly reversing that decision from a
     * fleet screen is exactly the kind of silent privilege restoration this
     * codebase refuses elsewhere (`UserAdminService` does not restore
     * tokens either). Giving the login back is an explicit act on the
     * account.
     */
    public function suspendAccountFor(Driver $driver): void
    {
        $account = $driver->user;

        if ($account === null || $account->status === UserStatus::SUSPENDED) {
            return;
        }

        $account->status = UserStatus::SUSPENDED;
        $account->deactivated_at = now();
        $account->save();

        $account->tokens()->delete();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function newAccount(Driver $driver, array $attributes): User
    {
        return User::create([
            // The profile's name by default: two names for one person, one
            // on the fleet screen and one in the topbar, is a support call.
            'name' => $attributes['name'] ?? $driver->name,
            'email' => $attributes['email'],
            'password' => $attributes['password'],
            'role' => $attributes['role'],
            'status' => UserStatus::ACTIVE,
            // Platform-level, always. ADR-0005 puts the fleet with the
            // platform: a driver is Shanitah's employee, not a client's, so
            // pinning the account to a tenant would both be false and hand
            // that tenant's scoped reads to somebody who is not theirs.
            'tenant_id' => null,
            // Whose employee, now that "the platform" is one fleet among
            // several (ADR-0055). Taken from the driver's own row rather than
            // from the actor: an office administrator creating the login is
            // not necessarily who the driver drives for, and the profile
            // already knows the answer.
            //
            // Without this the account would name neither a client nor a fleet
            // — which is **Kangaru**, head office. Three of the six null-client
            // accounts on the development database are drivers, so this is the
            // exact row the ADR-0055 §4 hazard was written about.
            'operator_id' => $driver->operator_id,
        ]);
    }

    /**
     * @throws DriverAccountConflictException
     */
    private function existingAccount(int $userId): User
    {
        /** @var User $account */
        $account = User::query()->whereKey($userId)->lockForUpdate()->firstOrFail();

        if (Driver::query()->where('user_id', $account->id)->exists()) {
            throw DriverAccountConflictException::accountBelongsToAnotherDriver($account);
        }

        return $account;
    }

    /**
     * Whether an account is capable of being a driver's.
     *
     * Asked of the *permission*, not the role slug, so ADR-0004's custom
     * roles work: a "Relief Driver" role holding `trips.transition.own` is
     * as valid here as the seeded `driver` one. An account without it would
     * link cleanly and then be refused by `TripPolicy` on every transition
     * — a login that exists and does nothing, which is the failure mode
     * this whole ADR is about.
     */
    public function canDrive(User $account): bool
    {
        return $account->hasPermission(Permission::TRIPS_TRANSITION_OWN);
    }
}
