<?php

namespace Modules\Administration\Services;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Modules\Administration\Models\Invitation;
use Modules\Notifications\Notifications\AccountInvitedNotification;

/**
 * Issuing and redeeming the link that gets somebody into a new account.
 *
 * ## What this replaces
 *
 * Nothing, which is the point. Two onboarding paths created an active account
 * with a random password nobody was told and a comment promising an
 * invitation that did not exist. This is that invitation.
 *
 * ## The account is active before the invitation is accepted
 *
 * Deliberately unchanged from what onboarding already did, and it looks wrong
 * until you read ADR-0059 §5: a fleet's account count may never reach zero,
 * because a fleet nobody can act as is a fleet nobody can support. An account
 * that only became active on acceptance would let that count sit at zero for
 * as long as somebody left the email unread.
 *
 * Active without a usable password is not a security hole. There is no
 * password to guess: `Str::password(32)` was generated and discarded, and the
 * only route in is this token or a reset code.
 */
class InvitationService
{
    /**
     * Issue a link and email it. Replaces any previous one for this account.
     *
     * Replacing rather than adding is the whole reason `user_id` is unique.
     * Two live links to one account is a second key to the same door, and the
     * older one is lying in an email that may have been forwarded on.
     *
     * Returns the invitation, never the token. The plaintext leaves this
     * method only inside the notification.
     */
    public function invite(User $user, ?User $invitedBy = null): Invitation
    {
        $token = Str::random(48);

        $invitation = DB::transaction(fn () => Invitation::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'token_hash' => $this->digest($token),
                'expires_at' => now()->addDays(Invitation::TTL_DAYS),
                // Null on a resend, which is what re-opens the link. Without
                // this, resending an invitation somebody already accepted
                // would hand them a token the guard refuses.
                'accepted_at' => null,
                'invited_by' => $invitedBy?->id,
            ],
        ));

        $user->notify(new AccountInvitedNotification($invitation, $token, $invitedBy));

        return $invitation;
    }

    /**
     * The invitation behind a token, or null.
     *
     * Returns expired and already-accepted rows too. The caller decides what
     * to say about them, because "this link expired" and "you have already
     * used this" send the reader to two different places and only one of them
     * needs a new email.
     */
    public function find(string $token): ?Invitation
    {
        return Invitation::query()
            ->where('token_hash', $this->digest($token))
            ->with('user')
            ->first();
    }

    /**
     * Set the password and burn the link.
     *
     * ## Every session is closed, exactly as a reset does
     *
     * `PasswordResetService::reset()` revokes every token on success and the
     * argument there holds here: a credential change that leaves an existing
     * session signed in has changed nothing for an attacker who already has
     * one. It matters more here, not less, because the account has been
     * sitting active with a password nobody chose.
     *
     * ## Refuses a suspended account
     *
     * A suspended account is one somebody decided should not be used. An
     * invitation issued before the suspension must not be the way around it,
     * and this is the same check `PasswordResetService` makes for the same
     * reason.
     */
    public function accept(Invitation $invitation, string $password): bool
    {
        if (! $invitation->isUsable()) {
            return false;
        }

        $user = $invitation->user;

        if ($user === null || $user->status !== UserStatus::ACTIVE) {
            return false;
        }

        DB::transaction(function () use ($invitation, $user, $password) {
            $user->password = $password;
            $user->save();

            $user->tokens()->delete();

            $invitation->update(['accepted_at' => now()]);
        });

        return true;
    }

    /**
     * Invitations that lapse within the reminder window and have not been used.
     *
     * @return Collection<int, Invitation>
     */
    public function expiringSoon(): Collection
    {
        return Invitation::query()
            ->whereNull('accepted_at')
            ->whereBetween('expires_at', [now(), now()->addHours(Invitation::REMIND_WITHIN_HOURS)])
            ->with('user')
            ->get();
    }

    /**
     * SHA-256, not bcrypt. See the migration: the digest has to be lookupable
     * from the token alone, and 48 random characters leave a salt nothing to
     * defend against.
     */
    private function digest(string $token): string
    {
        return hash('sha256', $token);
    }
}
