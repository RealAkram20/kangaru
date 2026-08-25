<?php

namespace Modules\Fleet\Services;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Modules\Fleet\Enums\TransferOutcome;
use Modules\Fleet\Models\OwnershipTransfer;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\FleetOwnershipInvitedNotification;
use Modules\Notifications\Notifications\OfficeEventNotification;
use Modules\Notifications\Notifications\SecurityEventNotification;

/**
 * A fleet changing hands (owner's decision, 24 August).
 *
 * *"Changing the email is changing the ownership"* — so it is not an email
 * edit. `UserAdminService::update()` can rewrite an address in place, which
 * is right for a typo and wrong for a handover: it re-attributes everything
 * the old person did to the new person's name. Here the new owner gets their
 * **own** account, minted at the moment they confirm, and the sitting
 * owner's account is suspended in the same transaction — the history keeps
 * saying who acted.
 *
 * ## Nothing exists until the confirmation
 *
 * Proposing writes one pending row and sends one email. No account, no
 * credential, no change to who owns the fleet. An unconfirmed transfer
 * expires into nothing, which is the owner's own specification: *"if the
 * email not comfirmed then we keep the old email."*
 */
class OwnershipTransferService
{
    /**
     * Propose a new owner. Replaces any pending transfer for this fleet —
     * one live link per door, the rule `invitations.user_id` enforces.
     *
     * The token leaves this method only inside the notification, exactly as
     * `InvitationService::invite()` promises of its own.
     */
    public function propose(Operator $operator, string $name, string $email, ?User $invitedBy = null): OwnershipTransfer
    {
        $token = Str::random(48);

        $transfer = DB::transaction(fn () => OwnershipTransfer::query()->updateOrCreate(
            ['operator_id' => $operator->id],
            [
                'name' => $name,
                'email' => $email,
                'token_hash' => $this->digest($token),
                'expires_at' => now()->addDays(OwnershipTransfer::TTL_DAYS),
                'accepted_at' => null,
                'invited_by' => $invitedBy?->id,
            ],
        ));

        // `Notification::route`, not `$user->notify()`: the whole point is
        // that this address has no account. The applicant path through
        // `SettingsMailChannel` exists for exactly this shape of recipient.
        Notification::route('mail', $email)->notify(
            new FleetOwnershipInvitedNotification($transfer, $operator, $token, $invitedBy),
        );

        return $transfer;
    }

    /** The pending transfer behind a token, or null. Expired and used rows
     * come back too — the caller owes them different sentences. */
    public function find(string $token): ?OwnershipTransfer
    {
        return OwnershipTransfer::query()
            ->where('token_hash', $this->digest($token))
            ->with('operator')
            ->first();
    }

    /** Head office changed its mind. The pending row is the whole of the
     * pending state, so deleting it is the whole of the withdrawal. */
    public function withdraw(Operator $operator): void
    {
        OwnershipTransfer::query()->where('operator_id', $operator->id)->delete();
    }

    /**
     * The new owner confirms: their account is created with the password
     * they chose, and the sitting owner's account is suspended — one
     * transaction, so the fleet is never ownerless in between (ADR-0059 §5
     * reads that direction too: create first, then suspend).
     */
    public function accept(OwnershipTransfer $transfer, string $password): TransferOutcome
    {
        if (! $transfer->isUsable()) {
            return TransferOutcome::LAPSED;
        }

        $operator = $transfer->operator;

        if ($operator === null) {
            return TransferOutcome::LAPSED;
        }

        /*
         * The address may have acquired an account since the invitation was
         * sent, and that is the ordinary case rather than the exception: a
         * driver application mints one at submission time (ADR-0055,
         * amendment), so the person head office invited on Monday can be an
         * account holder by Tuesday.
         *
         * This used to `return false`, which the controller reported as *"that
         * invitation has expired"* — a sentence that was false, unactionable,
         * and reached a real incoming fleet owner four hours after her link
         * was issued.
         *
         * An account that is free to move is now **promoted** rather than
         * refused. One that belongs to another organisation is refused by
         * name, because moving a person between organisations is the write
         * ADR-0065 exists to prevent.
         */
        $existing = User::query()->where('email', $transfer->email)->first();

        if ($existing !== null && ! self::mayTakeOver($existing, $operator)) {
            return TransferOutcome::ADDRESS_ELSEWHERE;
        }

        /** @var array{new: User, previous: array<int, User>} $outcome */
        $outcome = DB::transaction(function () use ($transfer, $operator, $password, $existing): array {
            $owner = $existing === null
                ? User::create([
                    'name' => $transfer->name,
                    'email' => $transfer->email,
                    // The password the new owner just chose — the only credential
                    // this flow ever mints, and nobody else knows it.
                    'password' => $password,
                    'role' => UserRole::FLEET_OWNER,
                    'status' => UserStatus::ACTIVE,
                    'tenant_id' => null,
                    'operator_id' => $operator->id,
                    'access_level' => AccessLevel::FLEET,
                ])
                : $this->promote($existing, $operator, $password);

            /*
             * The outgoing side. Suspended, never deleted — their trips,
             * dispatches and audit rows are what keeps the fleet's past
             * explicable, and they keep their name on all of it.
             * `deactivated_at` is stamped because AGENTS.md's retention
             * clock counts from it, and every token dies for the reason
             * `UserAdminService::revokeTokens` gives: a suspension that only
             * blocks the login form is not a suspension.
             */
            $previous = $operator->users()
                ->where('role', UserRole::FLEET_OWNER)
                ->where('status', UserStatus::ACTIVE)
                ->whereKeyNot($owner->id)
                ->get();

            foreach ($previous as $sitting) {
                $sitting->status = UserStatus::SUSPENDED;
                $sitting->deactivated_at = now();
                $sitting->save();
                $sitting->tokens()->delete();
            }

            $transfer->update(['accepted_at' => now()]);

            return ['new' => $owner, 'previous' => $previous->all()];
        });

        /*
         * Told after the commit, never inside it — a mail failure must not
         * roll back a handover the new owner just completed
         * (`UserAdminService::announceSecurityChanges` argues the same).
         *
         * The suspension notice is mail-only by its type, which is the one
         * channel that still reaches somebody whose sign-in just stopped
         * working. It is also the last message the platform will ever send
         * them about this account, which is why it is not optional.
         */
        foreach ($outcome['previous'] as $sitting) {
            $sitting->notify(new SecurityEventNotification(
                NotificationType::ACCOUNT_SUSPENDED,
                [__('mail.security.fact_when') => now()->isoFormat('D MMMM YYYY, HH:mm')],
            ));
        }

        // Head office hears the handover completed, on the same read
        // permission the onboarding notice uses: whoever watches the register
        // is who wants to know it changed hands.
        foreach (app(OfficeRecipient::class)->headOffice(Permission::FLEETS_VIEW) as $staff) {
            $staff->notify(new OfficeEventNotification(
                NotificationType::PLATFORM_FLEET_OWNERSHIP_TRANSFERRED,
                facts: [
                    __('mail.office.fact_fleet') => (string) $operator->name,
                    __('mail.office.fact_owner') => (string) $outcome['new']->name,
                ],
                url: '/fleets/'.$operator->getKey(),
                replacements: ['fleet' => (string) $operator->name, 'owner' => (string) $outcome['new']->name],
            ));
        }

        return TransferOutcome::ACCEPTED;
    }

    /**
     * Whether an existing account may become this fleet's owner.
     *
     * **Free to move**, and only that:
     *
     * - an **applicant** — somebody who filled in the public driver form and
     *   has an account keyed to nothing but their own application (ADR-0055,
     *   amendment). They belong to no organisation, so nothing is taken from
     *   anyone by their joining one.
     * - somebody **already at this fleet** — promoting a branch manager to
     *   owner moves nobody anywhere.
     *
     * Everything else is refused: another fleet's staff, a client's staff, and
     * head office. Letting a handover reach those would move a person between
     * organisations on the strength of an emailed link, which is the write
     * ADR-0065 spent a whole release closing on the read side.
     *
     * A suspended account is deliberately still eligible when it is otherwise
     * free to move — reinstating somebody by handing them a fleet is a
     * decision head office made when it typed their address, and refusing it
     * would leave no way to undo a suspension through this door.
     *
     * Returns the sentence to show, or null when the account may take over.
     * Public and static because `ProposeOwnerRequest` asks the same question
     * at the moment head office types the address — one rule, two moments,
     * because a week can pass in between and the world can move.
     */
    public static function ineligibleReason(User $candidate, Operator $operator): ?string
    {
        if ($candidate->access_level === AccessLevel::FLEET
            && $candidate->operator_id === $operator->getKey()) {
            // Somebody already at this fleet, which is the promote-a-branch-
            // manager case — unless they are the person the fleet already
            // belongs to, where there is nothing to hand over and the only
            // effect would be resetting their password through a door built
            // for something else.
            return $candidate->roleSlug() === UserRole::FLEET_OWNER->value
                && $candidate->status === UserStatus::ACTIVE
                ? 'They already own this fleet.'
                : null;
        }

        if ($candidate->access_level === AccessLevel::APPLICANT) {
            return null;
        }

        return 'That address belongs to an account at another organisation, so it cannot take this fleet over. Use another address.';
    }

    /** Whether an existing account may become this fleet's owner. */
    private static function mayTakeOver(User $candidate, Operator $operator): bool
    {
        return self::ineligibleReason($candidate, $operator) === null;
    }

    /**
     * Hands the fleet to an account that already exists.
     *
     * The account keeps **its own name**. Head office typed a name into the
     * invitation to say who they meant; it is not a licence to rewrite a
     * person's own record, and the two are the same person by construction.
     *
     * It does gain a password, which is the point of the accept form and is
     * worth naming plainly: this door sets the password of an existing
     * account. What makes that sound is the same thing that makes any
     * invitation sound — the token went to that address — narrowed further by
     * `mayTakeOver()`, so the reachable set is an applicant or this fleet's
     * own staff, never a stranger's account at another organisation.
     */
    private function promote(User $candidate, Operator $operator, string $password): User
    {
        // `role` is `@property-read` on the model deliberately — role changes
        // go through `fill()`, which is how `UserAdminService` writes them
        // too. The rest are assigned directly, like the status/`deactivated_at`
        // pair beside it, so the whole promotion is one save and one audit row.
        $candidate->fill([
            'role' => UserRole::FLEET_OWNER->value,
            'password' => $password,
        ]);
        $candidate->status = UserStatus::ACTIVE;
        $candidate->deactivated_at = null;
        $candidate->tenant_id = null;
        $candidate->operator_id = $operator->getKey();
        // Assigned rather than inferred, like every other write of this column
        // (ADR-0055 §4). An applicant becoming a fleet's owner is exactly the
        // level change the guard exists to make deliberate.
        $candidate->access_level = AccessLevel::FLEET;
        $candidate->save();

        return $candidate;
    }

    /** SHA-256, lookupable — the invitation table's own argument. */
    private function digest(string $token): string
    {
        return hash('sha256', $token);
    }
}
