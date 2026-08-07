<?php

namespace Modules\Administration\Services;

use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Requests\LoginRequest;

class AuthService
{
    public function __construct(private readonly MfaService $mfa) {}

    /**
     * Locates the user unscoped by tenant — login must find a user by email
     * before any tenant is known (User is deliberately not BelongsToTenant).
     *
     * ## Three outcomes since ADR-0008, not one
     *
     * - **No MFA required** — a token, exactly as before.
     * - **MFA required and enrolled** — *no token*. A `challenge_id` the
     *   client exchanges at `POST /auth/mfa/verify`. Decision 2: a partial
     *   token is a token, so nothing that authenticates a request exists
     *   until the factor is proved.
     * - **MFA required and not enrolled** — a token, and nothing it can do
     *   but enrol. Decision 3 forces enrolment rather than nagging, and
     *   `EnsureMfaEnrolled` is what makes the token useless for anything
     *   else. It has to be a real token because enrolling *is* an
     *   authenticated act — the alternative is a second kind of half-credential,
     *   which is the thing decision 2 refuses.
     *
     * @return array{user: User, token: string|null, challenge: string|null}
     */
    public function login(LoginRequest $request): array
    {
        // ADR-0022. Absent means the staff console, so every client that
        // predates this keeps the unscoped token it has always had.
        $client = $request->validated('client') ?? ClientScope::CONSOLE;

        $user = User::where('email', $request->validated('email'))->first();

        if (! $user || ! Hash::check($request->validated('password'), $user->password)) {
            throw new InvalidCredentialsException;
        }

        // A suspended account is refused with the *same* exception and the
        // same message as a wrong password, deliberately.
        //
        // Saying "this account is suspended" tells an attacker that the
        // address is real and that they guessed the password — the two
        // facts a credential-stuffing run is trying to learn. Suspension is
        // an internal state; the person it affects finds out from their
        // administrator, not from the login form.
        //
        // Checked after the hash, so the response time does not distinguish
        // a suspended account from an active one either.
        if (! $user->status->canSignIn()) {
            throw new InvalidCredentialsException;
        }

        // The second factor, for a user who has one (ADR-0008 decision 2).
        // Checked after the status check, so the ordering of the three
        // refusals above is unchanged and none of them is distinguishable
        // by timing.
        //
        // ADR-0010 decision 1: the **factor**, not the role. This read
        // `requiresMfa() && hasMfaEnabled()`, which meant a user whose role
        // does not demand a second factor could enrol — the endpoint is
        // gated on authentication, not role — see `mfa_enabled: true` on
        // their own account, file ten recovery codes, and never once be
        // asked for a code. The platform was not failing to protect them; it
        // was reporting protection it did not provide.
        //
        // `requiresMfa()` still decides who *must* enrol, through
        // `mustEnrolInMfa()` and the EnsureMfaEnrolled middleware. It no
        // longer decides who gets asked.
        if ($user->hasMfaEnabled()) {
            return [
                'user' => $user,
                'token' => null,
                'challenge' => $this->mfa->issueChallenge($user),
            ];
        }

        return [
            'user' => $user,
            'token' => $this->issueToken($user, $client),
            'challenge' => null,
        ];
    }

    /**
     * The second step: a challenge plus a code, for a token.
     *
     * @return array{user: User, token: string}
     *
     * @throws InvalidMfaChallengeException|InvalidMfaCodeException
     */
    public function verifyMfa(string $challenge, string $code, string $client = ClientScope::CONSOLE): array
    {
        $user = $this->mfa->verifyChallenge($challenge, $code);

        // Re-checked here rather than trusted from the challenge. A
        // challenge can outlive a suspension by up to five minutes, and an
        // account deactivated during that window must not be able to spend
        // the ticket it was issued a moment earlier.
        if (! $user->status->canSignIn()) {
            throw new InvalidCredentialsException;
        }

        return ['user' => $user, 'token' => $this->issueToken($user, $client)];
    }

    /**
     * Mints a token scoped to the app that asked for it (ADR-0022).
     *
     * The client is **self-declared**, and that is honest rather than weak.
     * It cannot defend against the person signing in — they may always ask
     * for a console token, exactly as they may open the web console. What
     * it bounds is a *token's* reach: one sitting on a driver's phone, in a
     * mobile app's storage, or in a proxy log, can only ever touch the
     * driver surface. Losing a phone stops being a question about what that
     * driver is allowed to do.
     *
     * The token's name carries the client too. Somebody reading
     * `personal_access_tokens` during an incident needs to know which
     * device a row is for, and every one of them used to say "api".
     */
    private function issueToken(User $user, string $client): string
    {
        return $user->createToken($client, ClientScope::abilitiesFor($client))->plainTextToken;
    }

    public function logout(User $user): void
    {
        $user->currentAccessToken()->delete();
    }

    /**
     * Sets a new password and signs every device out, including this one.
     *
     * A password change usually follows "I think somebody else has this",
     * so leaving old sessions alive would defeat it.
     *
     * Keeping the *current* token alive would be friendlier, and was the
     * first attempt — but identifying it means calling
     * `currentAccessToken()`, which Sanctum types as non-nullable while
     * returning a `TransientToken` with no key under some guards. The
     * choice was a fragile exception or a blunt rule, and for a credential
     * change the blunt rule is also the safer one: everything goes, and the
     * new password is used immediately to sign back in. The endpoint says
     * so in its response.
     *
     * `password` is a hashed cast on the model, so the plaintext is never
     * what gets stored.
     */
    public function changePassword(User $user, string $password): void
    {
        $user->password = $password;
        $user->save();

        $user->tokens()->delete();
    }
}
