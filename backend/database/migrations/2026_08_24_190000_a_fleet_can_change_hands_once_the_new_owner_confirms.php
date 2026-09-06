<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A fleet changing hands, pending until the new owner confirms.
     *
     * The owner's decision of 24 August: *"changing the email is changing the
     * ownership"*. Head office names a new owner by email; that address gets
     * a welcome email to choose a password; **and until they do, nothing has
     * changed** — no account exists, the sitting owner keeps every access,
     * and an unconfirmed or expired transfer leaves no trace but this row.
     *
     * ## Why this is not `UserAdminService::update()` writing `email`
     *
     * That path exists and changes an address in place, which is right for a
     * typo and wrong for a handover: it re-attributes every audit row, trip
     * decision and invoice the *old* person made to the *new* person's name.
     * A transfer instead creates the new owner's own account at acceptance
     * and suspends the old one, so the history keeps saying who acted.
     *
     * ## Why it is not an `invitations` row either
     *
     * An invitation belongs to a `user_id`, and the whole point here is that
     * no user may exist until the confirmation. The mail also has to reach an
     * address the platform has no account for, which the invitation's
     * notification — routed to its user — cannot do.
     *
     * Token stored as a SHA-256 digest, lookupable, for exactly the reasons
     * `invitations` records: 48 random characters leave a salt nothing to
     * defend against, and the caller supplies nothing else to find the row by.
     */
    public function up(): void
    {
        Schema::create('ownership_transfers', function (Blueprint $table) {
            $table->id();

            /*
             * One live transfer per fleet — proposing a different new owner
             * replaces the row and kills the earlier link, the same
             * one-key-per-door rule `invitations.user_id` enforces.
             *
             * cascadeOnDelete: operators are never deleted (OperatorPolicy),
             * so this is belt for a braces that should never be reached.
             */
            $table->foreignId('operator_id')->unique()->constrained()->cascadeOnDelete();

            /* Who the fleet is being handed to. No users row yet, on purpose. */
            $table->string('name');
            $table->string('email');

            $table->char('token_hash', 64)->unique();

            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();

            /* Who proposed it — head office, named in the welcome email so the
             * reader has somebody to check with. nullOnDelete for the reason
             * `invitations.invited_by` gives: the handover stays valid when
             * the person who arranged it leaves. */
            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ownership_transfers');
    }
};
