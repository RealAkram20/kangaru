<?php

namespace Modules\Notifications\Mail;

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\User;

/**
 * Which of the four audiences a recipient belongs to, and the one sentence
 * the footer says because of it.
 *
 * ## Why this is a class and not a `match` inside the channel
 *
 * Because the same question has a second, much more dangerous caller. The mail
 * plan §6 rule is that **an email about a fleet's operations goes to that
 * fleet and to nobody else**, and ADR-0062 already draws that line for reads.
 * A recipient list is the easiest place in this codebase to cross it, because
 * a leak there looks like a helpful CC rather than like a bug.
 *
 * Keeping "who is this person, and which fleet do they belong to" in one place
 * means the guard can be tested once and reused, instead of being re-derived
 * at every send site where somebody might get it subtly wrong.
 *
 * ## The reason line is not decoration
 *
 * A transactional email with no stated reason is indistinguishable from a
 * phishing attempt, and the very first email this platform sends a new client
 * is one asking them to set a password. Naming the account and why it arrived
 * is what makes that credible.
 */
class MailAudience
{
    public function __construct(private readonly string $appName) {}

    /**
     * The footer line for this recipient.
     *
     * **Role is asked before level, and it has to be.** There is no
     * `AccessLevel::DRIVER`: a driver belongs to a fleet, so their level is
     * `FLEET`, the same as their dispatcher's. Reading the level alone would
     * tell every driver on the platform that they work at the fleet office,
     * which is both wrong and the kind of wrong that makes a reader distrust
     * the rest of the email.
     *
     * Falls back to the account wording rather than to nothing. An unknown
     * level is a bug, but the email that exposes it should still explain
     * itself to the person holding it.
     */
    public function reasonFor(User $user): string
    {
        if ($user->role === UserRole::DRIVER) {
            return __('mail.reason.driver', ['app' => $this->appName]);
        }

        return match ($user->access_level) {
            AccessLevel::APPLICANT => __('mail.reason.applicant', ['app' => $this->appName]),
            AccessLevel::CLIENT => __('mail.reason.client', [
                'app' => $this->appName,
                'company' => $this->companyNameFor($user),
            ]),
            AccessLevel::FLEET => __('mail.reason.fleet', [
                'app' => $this->appName,
                'company' => $this->fleetNameFor($user),
            ]),
            // No `default`. Every case is named, so adding a fifth access
            // level makes this a compile-time question rather than one that
            // silently falls through to the generic wording.
            AccessLevel::KANGARU => __('mail.reason.platform', ['app' => $this->appName]),
        };
    }

    /**
     * The fleet whose operations an email concerns, taken from the recipient.
     *
     * Null for head office and for a client, and that is correct rather than
     * missing: neither belongs to a fleet, and stamping one on their delivery
     * row would make the cross-fleet audit query answer wrongly.
     */
    public function operatorIdFor(User $user): ?int
    {
        return $user->operator_id;
    }

    private function companyNameFor(User $user): string
    {
        // The tenant's name, not the company profile's. A client onboarded
        // under a trading name is known by it, and the tenant row is where
        // ClientOnboardingService put whichever name they gave.
        return (string) ($user->tenant->name ?? $this->appName);
    }

    private function fleetNameFor(User $user): string
    {
        return (string) ($user->operator->name ?? $this->appName);
    }
}
