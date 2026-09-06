<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The second hand on an audited action (ADR-0056 §2).
 *
 * ## The refusal this answers
 *
 * `AuthController::changePassword` refuses to let an administrator reset
 * somebody else's password, and names its reason: that is *"the one act an
 * audit trail cannot tell apart from impersonation"*. `Modules/Customers/
 * Routes/staff.php` says the same thing about acting as a customer.
 *
 * The objection was never to impersonation. It was to impersonation the trail
 * **cannot distinguish from the person's own hand**. This column is the
 * distinction, and it is why ADR-0056 could be written at all.
 *
 * ## `user_id` stays the subject, and that is deliberate
 *
 * The obvious alternative — put the Kangaru employee in `user_id` and the
 * subject somewhere else — breaks the reading a client actually needs. Their
 * own audit view is a chronology of *their account's* activity; an action that
 * suddenly names an employee of the supplier reads as an unrelated event
 * dropped into the middle of it.
 *
 * So the row keeps saying what the account did, and gains a column saying who
 * was holding it. Rendered, ADR-0056 §2 requires both together — *"Kangaru
 * Support (acting as J. Okello)"*, never one without the other.
 *
 * ## Nullable, and null means what it says
 *
 * Null is "the person themselves", which is every row written before this
 * migration and almost every row after it. There is no backfill because there
 * is nothing to backfill: no impersonation has ever been possible, so no
 * historic row is ambiguous.
 *
 * `nullOnDelete` rather than `restrict`, unlike `impersonation_sessions`.
 * `audit_logs` is append-only and its `user_id` already uses `nullOnDelete`
 * for the same reason: a deleted account must not take the trail of what it
 * did with it. The session table keeps the harder guarantee; this one keeps
 * the row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->foreignId('impersonator_id')
                ->nullable()
                ->after('user_id')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropForeign(['impersonator_id']);
            $table->dropColumn('impersonator_id');
        });
    }
};
