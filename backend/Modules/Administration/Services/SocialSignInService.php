<?php

namespace Modules\Administration\Services;

use App\Enums\Permission;
use App\Enums\UserStatus;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Modules\Administration\Models\SocialIdentity;

/**
 * Who a verified provider identity is on this platform (ADR-0028 §3).
 *
 * The resolution ladder, each rung deliberately narrow:
 *
 * 1. a linked identity signs in;
 * 2. a provider-VERIFIED email matching an account that can drive links
 *    and signs in;
 * 3. everybody else is an applicant — name and email handed back, no
 *    principal created. ADR-0027 §1 does not bend for OAuth.
 *
 * Refusals before any of that: suspended accounts (silently, as
 * `sign_up` — a social probe must not confirm an address is real, which is
 * the same oracle the login form refuses to be), MFA-enrolled accounts
 * (social has no second factor and must not bypass one), and accounts that
 * cannot drive (this is the Driver App's door; a Finance login has no
 * business fitting through it).
 */
class SocialSignInService
{
    public function __construct(private readonly AuthService $auth) {}

    /**
     * @param  array{provider_id: string, email: string, email_verified: bool, name: string}  $claims
     * @return array{kind: 'signed_in', user: User, token: string}
     *                                                             |array{kind: 'sign_up', name: string, email: string}
     *                                                             |array{kind: 'mfa_required'}
     *                                                             |array{kind: 'not_a_driver'}
     */
    public function resolve(string $provider, array $claims): array
    {
        // The relation is null only if the account was hard-deleted, which
        // cascadeOnDelete makes impossible while the identity row exists —
        // but the type system cannot know that, and falling through to the
        // ladder below is also the right answer if it ever became true.
        $linkedUser = SocialIdentity::query()
            ->where('provider', $provider)
            ->where('provider_id', $claims['provider_id'])
            ->first()?->user;

        if ($linkedUser !== null) {
            return $this->signIn($linkedUser);
        }

        // The email match is only honoured when the provider vouches for
        // the address. An unverified assertion is an account-takeover kit:
        // anyone can create a social profile claiming a driver's email.
        $user = $claims['email_verified']
            ? User::query()->where('email', $claims['email'])->first()
            : null;

        if ($user === null) {
            // A stranger. Nothing is created (ADR-0027 §1) — the app takes
            // these two fields to the application form and the office still
            // decides.
            return ['kind' => 'sign_up', 'name' => $claims['name'], 'email' => $claims['email']];
        }

        if ($user->status !== UserStatus::ACTIVE) {
            // Indistinguishable from "no account": a suspended account
            // answered differently would confirm the address exists, the
            // exact fact AuthService::login hides behind its identical
            // refusals.
            return ['kind' => 'sign_up', 'name' => $claims['name'], 'email' => $claims['email']];
        }

        if ($user->mustPresentMfa()) {
            return ['kind' => 'mfa_required'];
        }

        if (! $user->hasPermission(Permission::TRIPS_TRANSITION_OWN)) {
            return ['kind' => 'not_a_driver'];
        }

        SocialIdentity::create([
            'user_id' => $user->id,
            'provider' => $provider,
            'provider_id' => $claims['provider_id'],
            'email_at_link' => $claims['email'],
        ]);

        return $this->signIn($user);
    }

    /**
     * @return array{kind: 'signed_in', user: User, token: string}
     *                                                             |array{kind: 'sign_up', name: string, email: string}
     *                                                             |array{kind: 'mfa_required'}
     *                                                             |array{kind: 'not_a_driver'}
     */
    private function signIn(User $user): array
    {
        // Everything the linked path skipped still applies at sign-in time:
        // a link made last month says nothing about who was suspended or
        // MFA-enrolled since.
        if ($user->status !== UserStatus::ACTIVE) {
            return ['kind' => 'sign_up', 'name' => $user->name, 'email' => $user->email];
        }

        if ($user->mustPresentMfa()) {
            return ['kind' => 'mfa_required'];
        }

        if (! $user->hasPermission(Permission::TRIPS_TRANSITION_OWN)) {
            return ['kind' => 'not_a_driver'];
        }

        return [
            'kind' => 'signed_in',
            'user' => $user,
            // The same minting as a password login for the same client
            // (ADR-0022): a Google door into the driver surface is still the
            // driver surface.
            'token' => $this->auth->issueToken($user, ClientScope::DRIVER),
        ];
    }
}
