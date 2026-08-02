<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * In-app notifications, one row per recipient.
     *
     * Deliberately not Laravel's own `notifications` table. That one keys
     * on a `notifiable` morph and carries no tenant column, and ADR-0001
     * requires "every tenant-owned table carries a non-nullable, indexed,
     * foreign-keyed tenant_id". A notification quotes a booking's origin
     * and a passenger's name, so it is tenant-owned data by any reading —
     * bolting scoping onto the framework table would have meant a global
     * scope on a model this application does not own.
     *
     * Unlike `audit_logs`, whose tenant_id is nullable because platform-level
     * actions exist before a tenant does, every notification has a recipient
     * and every recipient belongs to a tenant.
     */
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->id();

            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // cascadeOnDelete, unlike audit_logs' nullOnDelete: an audit row
            // must outlive the user who caused it, but a notification with
            // no recipient is addressed to nobody and is not a record of
            // anything. The audit trail is what survives a deleted user.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // The stable name from NotificationType — "booking.approved".
            // Plain varchar rather than ENUM, matching users.role: adding a
            // notification type must not require a DDL change on a table
            // this size.
            $table->string('type');

            // Rendered at dispatch time and then frozen. A notification is a
            // record of what someone was told, so it must not silently
            // re-render later against changed data — see the Notification
            // model, which refuses every update except marking it read.
            $table->string('subject');
            $table->text('body');

            // Relative, e.g. "/bookings/41". Stored rather than derived so a
            // notification keeps pointing where it pointed even if routing
            // changes, and nullable because not every notification has
            // somewhere useful to go.
            $table->string('url')->nullable();

            // The structured payload behind the sentence: ids and figures a
            // client can branch on without parsing prose.
            $table->json('context')->nullable();

            $table->timestamp('read_at')->nullable();

            $table->timestamps();

            // The unread badge and the list are both "this user's, newest
            // first", so the index leads with the recipient. read_at is last
            // because it is a filter on top of that, never on its own.
            $table->index(['tenant_id', 'user_id', 'read_at']);
            $table->index(['tenant_id', 'user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
