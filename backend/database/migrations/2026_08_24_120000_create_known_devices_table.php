<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Browsers and handsets an account has signed in from before, so a sign-in
     * from a new one can be said out loud (mail plan A5).
     *
     * ## Keyed on the user agent, never on the IP address
     *
     * This is the decision that makes the feature usable in Uganda rather than
     * merely correct in a lab.
     *
     * An IP-keyed device looks stricter and is worse than useless here. A
     * driver upcountry on a mobile network gets a different address several
     * times a day, PRODUCT.md's operating context says connectivity is
     * unreliable, and the result would be a "new sign in" email every morning.
     * A warning that arrives daily is a warning nobody reads on the day it
     * matters, and it would train the entire fleet to delete the one message
     * that means somebody has taken their account.
     *
     * So the key is a SHA-256 of the user agent alone. That is a coarse
     * signal: two colleagues on the same phone model and browser version hash
     * the same, and a browser update looks like a new device. Both are
     * accepted, and the direction of the error is what makes them acceptable.
     * A browser update sends one extra email that says "if this was you,
     * nothing to do"; the collision case only ever *misses* a warning for an
     * attacker who is on an identical build, which is no worse than the
     * nothing that existed before this table.
     *
     * ## The address is recorded but not part of the key
     *
     * `last_ip` is here because "where from" is the first thing somebody asks
     * when they get one of these, and because a support person needs it. It
     * never decides whether the email is sent.
     *
     * ## Not a session, and not a device the user manages
     *
     * There is no revoke, no list, no "sign out this device". Those are a
     * different feature with their own screen, and building half of one here
     * would be the "half-built feature" `docs/feature-completeness.md` exists
     * to prevent. This table answers exactly one question: have we seen this
     * browser on this account before.
     */
    public function up(): void
    {
        Schema::create('known_devices', function (Blueprint $table) {
            $table->id();

            /* cascadeOnDelete: this is a property of the account, not a record
             * of anything. The `mail_deliveries` row is what proves a warning
             * was sent, and that one outlives the account. */
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            /* SHA-256 of the user agent. 64 hex characters. The raw string is
             * not stored: it is a fingerprint of somebody's software and it
             * buys nothing here that the digest does not. */
            $table->char('user_agent_hash', 64);

            /* Trimmed for a support person to read, and nullable because a
             * request can arrive without one. Never part of the key. */
            $table->string('user_agent_label', 190)->nullable();

            /* Recorded, never compared. See the note above. */
            $table->string('last_ip', 45)->nullable();

            $table->timestamp('last_seen_at');
            $table->timestamps();

            /* The pair is the identity, and unique is what makes "have we seen
             * this before" a single upsert rather than a read then a write
             * with a race between them. Two simultaneous sign-ins from one
             * browser must not send two emails. */
            $table->unique(['user_id', 'user_agent_hash']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('known_devices');
    }
};
