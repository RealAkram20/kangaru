<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use App\Support\Auth\PasswordPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Administration\Models\Invitation;
use Modules\Administration\Services\InvitationService;

/**
 * The public half of the invitation (mail plan M2).
 *
 * Unauthenticated of necessity, exactly like `PasswordResetController`: the
 * caller's whole situation is that they cannot authenticate yet. The token is
 * the credential, and it is the only one.
 *
 * ## Why this does not answer identically for every failure
 *
 * `PasswordResetController` deliberately gives one answer whether or not an
 * email exists, because the caller supplies the email and a different answer
 * would confirm who banks here. Nothing is confirmed here that the caller did
 * not already hold: they arrived with 48 random characters, and possession of
 * a valid token *is* the identification.
 *
 * So the three failures get three answers, because they send the reader to
 * three different places:
 *
 * - **unknown token** — a mistyped or truncated link. Ask for the link again.
 * - **already accepted** — go and sign in. Telling this person "expired" would
 *   have them chasing a new email they do not need.
 * - **expired** — ask the office for a new one.
 *
 * An unknown token still reveals nothing: it says a random string is not a
 * valid invitation, which was true of every random string before the request.
 */
class InvitationController extends Controller
{
    public function __construct(private readonly InvitationService $invitations) {}

    /**
     * What the accept page shows before anybody types anything.
     *
     * The name, the address and the company. All three belong to the holder of
     * the token, which is the person reading, and the page needs them to be
     * able to say "you are setting a password for this account" rather than
     * asking somebody to trust a bare form.
     */
    public function show(string $token): JsonResponse
    {
        $invitation = $this->invitations->find($token);

        if ($invitation === null || $invitation->user === null) {
            return $this->unknown();
        }

        if ($invitation->accepted_at !== null) {
            return $this->alreadyAccepted();
        }

        if ($invitation->expires_at->isPast()) {
            return $this->expired();
        }

        return ApiResponse::success([
            'name' => $invitation->user->name,
            'email' => $invitation->user->email,
            'expires_at' => $invitation->expires_at->toIso8601String(),
        ]);
    }

    /**
     * Sets the password and burns the link.
     *
     * Answers success rather than a session. Signing somebody in from here
     * would skip the second factor that ADR-0008 requires of a Super Admin or
     * a Finance officer, and the roles most likely to be invited are exactly
     * those two. Sending them to the sign-in screen also exercises the
     * password they just chose, while they are still at the keyboard to fix a
     * typo.
     */
    public function accept(Request $request, string $token): JsonResponse
    {
        $validated = $request->validate([
            // The same floor a reset sets, and it has to be: an invitation
            // that accepted a weaker password than a reset would be the
            // weakest door into a brand new account.
            'password' => ['required', 'string', 'confirmed', PasswordPolicy::rule()],
        ]);

        $invitation = $this->invitations->find($token);

        if ($invitation === null || $invitation->user === null) {
            return $this->unknown();
        }

        if ($invitation->accepted_at !== null) {
            return $this->alreadyAccepted();
        }

        if (! $this->invitations->accept($invitation, $validated['password'])) {
            // Either it lapsed between the two requests, or the account was
            // suspended after the invitation went out. A suspended account is
            // one somebody decided should not be used, and an invitation
            // issued beforehand must not be the way around that.
            return $this->expired();
        }

        return ApiResponse::success(
            null,
            'Your password is set. Sign in with it.',
        );
    }

    private function unknown(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'That invitation link is not valid. Check you copied the whole link, or ask for a new one.',
            [],
            404,
        );
    }

    private function alreadyAccepted(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::INVITATION_ALREADY_USED,
            'This invitation has already been used. Sign in with the password you chose.',
            [],
            409,
        );
    }

    private function expired(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::INVITATION_EXPIRED,
            'That invitation has expired. Ask the person who set up your account to send a new one. Links last '
            .Invitation::TTL_DAYS.' days.',
            [],
            410,
        );
    }
}
