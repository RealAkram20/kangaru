<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0008: a second factor for the roles that can move money.
 *
 * AGENTS.md has required this since the project started — "MFA is required
 * for Super Admin and Finance roles in Phase 1, these roles can move money
 * and change rates" — and the client is a bank.
 *
 * ## `roles.requires_mfa`, not two hardcoded slugs
 *
 * ADR-0008: "The mechanism should be a per-role flag from the start so
 * extending it is configuration rather than a release." Since ADR-0004 a
 * role is a **row**, and custom roles exist — one holding `invoices.manage`
 * would move money exactly as Finance does, so the requirement has to be
 * something a Super Admin can set on it rather than a constant naming two
 * enum cases.
 *
 * Seeded true for `super_admin` and `finance`, which is PROJECT.md's list
 * and no wider: PROJECT.md puts MFA for other roles out of Phase 1.
 *
 * ## The secrets
 *
 * `mfa_secret` and `mfa_recovery_codes` are app-level encrypted, the same
 * treatment AGENTS.md requires for driver documents. A TOTP secret in
 * plaintext is a second factor anybody with a database dump can compute.
 *
 * Recovery codes are hashed *individually* inside the encrypted column
 * rather than merely encrypted — nothing ever needs to read one back, only
 * to check one, so they get the password treatment. The encryption is a
 * second layer over the hashes, not the protection itself.
 *
 * ## Challenges are a table, not a cache entry
 *
 * A challenge is issued when a password succeeds and spent when a code
 * does, so it is a short-lived record of an authentication attempt. Redis
 * is not available (ADR-0003's Redis half is deliberately unbuilt, and
 * there is no Redis in this environment at all), and the database is where
 * something auditable and expirable belongs anyway.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->boolean('requires_mfa')->default(false)->after('is_system');
        });

        // The two roles AGENTS.md and PROJECT.md both name. Set here rather
        // than only in the seeder so an existing database gains the
        // requirement on migrate, not on a reseed nobody runs in production.
        DB::table('roles')->whereIn('slug', ['super_admin', 'finance'])->update(['requires_mfa' => true]);

        Schema::table('users', function (Blueprint $table) {
            // Nullable: null means "not enrolled", which for a user in an
            // MFA-required role is the state that forces enrolment rather
            // than an error.
            $table->text('mfa_secret')->nullable()->after('password');

            // Enrolment is only complete once a code has been verified.
            // Storing a secret without this would let a half-finished
            // enrolment lock somebody out of an authenticator they never
            // actually scanned.
            $table->timestamp('mfa_confirmed_at')->nullable()->after('mfa_secret');

            $table->text('mfa_recovery_codes')->nullable()->after('mfa_confirmed_at');
        });

        Schema::create('mfa_challenges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // The id handed to the client is random and looked up by hash,
            // so a database disclosure does not yield usable challenge ids
            // for any challenge still inside its five-minute window.
            $table->string('token_hash', 64)->unique();

            $table->timestamp('expires_at');
            // Single-use. Kept rather than deleted so a replay is
            // distinguishable from an expiry, and so the row is still there
            // to be counted by the per-account rate limit.
            $table->timestamp('consumed_at')->nullable();

            $table->timestamps();

            // "Is this challenge live" and "how many has this account been
            // issued lately" are the two questions asked of this table.
            $table->index(['user_id', 'created_at']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mfa_challenges');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['mfa_secret', 'mfa_confirmed_at', 'mfa_recovery_codes']);
        });

        Schema::table('roles', function (Blueprint $table) {
            $table->dropColumn('requires_mfa');
        });
    }
};
