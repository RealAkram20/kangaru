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
    public function accept(OwnershipTransfer $transfer, string $password): bool
    {
        if (! $transfer->isUsable()) {
            return false;
        }

        $operator = $transfer->operator;

        if ($operator === null) {
            return false;
        }

        // The address was free when the transfer was proposed and the unique
        // rule said so; a week may have passed. Refused rather than crashed
        // on the unique index — head office re-proposes with the story known.
        if (User::query()->where('email', $transfer->email)->exists()) {
            return false;
        }

        /** @var array{new: User, previous: array<int, User>} $outcome */
        $outcome = DB::transaction(function () use ($transfer, $operator, $password): array {
            $owner = User::create([
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
            ]);

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

        return true;
    }

    /** SHA-256, lookupable — the invitation table's own argument. */
    private function digest(string $token): string
    {
        return hash('sha256', $token);
    }
}
