<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The claim ticket an applicant uploads with (ADR-0048 §4).
     *
     * ADR-0027 §1 said an applicant "has no credentials on this platform at
     * all", and meant it as protection for `drivers.user_id` — the link
     * `TripPolicy` reads to decide whose trip is whose. **This is not that.**
     * The secret below resolves to exactly one `driver_applications` row and
     * authorises exactly three verbs against exactly one sub-resource. There
     * is no code path from it to a session, a policy, a trip or another
     * application. It is a cloakroom ticket, not a principal.
     *
     * ## Hashed, for the same reason a password is
     *
     * It is a bearer secret, so the column holds `hash('sha256', $plain)` and
     * the plaintext is returned once, in the submission response, and never
     * again. A database dump therefore does not hand out the ability to
     * overwrite anybody's documents.
     *
     * SHA-256 rather than bcrypt, deliberately, and the difference from
     * `driver_applications.password` matters: this value is 48 bytes from a
     * CSPRNG, not something a human chose, so there is nothing to brute-force
     * and the work factor bcrypt exists to provide buys nothing. What it
     * *costs* is a per-request bcrypt comparison on a lookup that has to find
     * the row by the hash — which bcrypt cannot do at all, because its salt is
     * per-hash and two hashes of one secret differ.
     *
     * ## It dies three ways
     *
     * The expiry below (24 hours), the decision — approve and reject both
     * clear it in the same transaction that clears the password ADR-0027 §3
     * stores — and the 90-day sweep on abandoned applications.
     *
     * Unique, because a collision between two live tickets would let one
     * applicant write into another's application. At 48 random bytes that is
     * not going to happen; the index is what makes it impossible rather than
     * unlikely, and it is the index the lookup uses anyway.
     */
    public function up(): void
    {
        Schema::table('driver_applications', function (Blueprint $table) {
            $table->string('upload_token_hash', 64)->nullable()->unique()->after('password');
            $table->timestamp('upload_token_expires_at')->nullable()->after('upload_token_hash');
        });
    }

    public function down(): void
    {
        Schema::table('driver_applications', function (Blueprint $table) {
            $table->dropUnique(['upload_token_hash']);
            $table->dropColumn(['upload_token_hash', 'upload_token_expires_at']);
        });
    }
};
