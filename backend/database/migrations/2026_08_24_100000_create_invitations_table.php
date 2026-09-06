<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * How somebody gets into an account nobody told them the password for.
     *
     * ## The hole this closes
     *
     * `ClientOnboardingService::firstAdministrator()` and
     * `OperatorService::onboard()` both create an active account with
     * `Str::password(32)` and discard it. Both carry a comment saying the
     * account is reached by an invitation. `StoreUserRequest` says plainly why
     * there was none: *"An invite flow needs a signed, expiring token and a
     * public accept-invite page, neither of which exists — and a half-built
     * invite that emails a link to nowhere is worse than an honest 'tell them
     * this password'."*
     *
     * That reasoning was right, and it left a corporate client admin and a
     * fleet owner as **accounts nobody could sign into**. The forgot-password
     * escape hatch was closed twice over, by a disabled flag and by an
     * unconfigured mailer. This is the missing half.
     *
     * ## The token is stored as a SHA-256 digest, not bcrypt
     *
     * Deliberate, and the opposite of `password_reset_tokens` beside it.
     *
     * A reset code is six digits: low entropy, guessable, so it is bcrypt
     * hashed and found by the email address the caller supplies. An
     * invitation token is 48 random characters and the caller supplies
     * nothing else, so the digest has to be **lookupable** — and with that
     * much entropy there is nothing for a salt to defend against. Sanctum
     * hashes its personal access tokens the same way for the same reason.
     *
     * ## One live invitation per account
     *
     * `user_id` is unique. Resending replaces the row, which kills the
     * previous link. Two valid links to one account is a second key to the
     * same door, left lying in an older email that may have been forwarded.
     */
    public function up(): void
    {
        Schema::create('invitations', function (Blueprint $table) {
            $table->id();

            /*
             * cascadeOnDelete: an invitation to an account that no longer
             * exists is a link to nothing. This is not a record of anything
             * the way `mail_deliveries` is, so it does not need to outlive
             * its subject. The delivery row is what proves an invitation was
             * sent, and that one survives.
             */
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            /* SHA-256 of the token in the link. 64 hex characters. */
            $table->char('token_hash', 64)->unique();

            $table->timestamp('expires_at');

            /*
             * Set once, and it is what makes the link single use. Checked
             * before expiry in the service, so somebody clicking a link they
             * already used is told that rather than being told it expired,
             * which would send them to ask for another one they do not need.
             */
            $table->timestamp('accepted_at')->nullable();

            /*
             * Who sent it. nullOnDelete because the invitation stays valid
             * when the person who issued it leaves, which is exactly the case
             * ADR-0059 §5 worries about: "the last administrator left" and
             * "we need to get in" are correlated events.
             */
            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            /* The daily sweep that warns before an invitation lapses reads
             * exactly this pair. */
            $table->index(['accepted_at', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invitations');
    }
};
