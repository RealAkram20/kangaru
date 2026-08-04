<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0013 §1: a customer is a separate principal, not a row in `users`.
 *
 * `users.role` maps into the permission catalogue, and every staff surface
 * — policies, the staff list, the role editor, RolePermissionParityTest —
 * assumes each `User` is one of ADR-0004's actors. A customer wedged in
 * there would need a fake role and a special case on all of them, forever.
 *
 * Deliberately **no `tenant_id`**, per ADR-0005: the walk-in customer is
 * the platform's own customer, like the fleet and like `order_requests`.
 *
 * Both credential columns are nullable because each is one of two ways in
 * (ADR-0013 §3): a Google-only customer has no password, a password
 * customer no `google_id`. What must not exist is a row with neither —
 * enforced in the registration service, where the invariant is readable,
 * not as a CHECK constraint MySQL would bury in a schema dump.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            // A contact field the dispatcher dials — never a verification
            // channel (no SMS anywhere, AGENTS.md). Same loose shape the
            // public order form accepts.
            $table->string('phone', 32);
            // The login identifier, so unique. 190 keeps the index inside
            // utf8mb4 key limits, matching users.email and
            // order_requests.contact_email.
            $table->string('email', 190)->unique();
            $table->string('password')->nullable();
            // Google's stable subject claim (`sub`), not the email — an
            // email can move between Google accounts; `sub` cannot.
            $table->string('google_id', 64)->nullable()->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
