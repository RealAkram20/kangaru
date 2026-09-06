<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One row per email the platform tried to send.
     *
     * ## Why this table exists at all
     *
     * Support cannot answer *"did the client get the invoice"* from
     * `storage/logs/laravel.log`, and PRODUCT.md positions this platform on
     * audit-grade correctness. An invoice that a finance officer says never
     * arrived is a commercial dispute, and the only thing that settles it is
     * a record of what was sent, to which address, and what the transport
     * said back.
     *
     * It is also the only place a **send limit** becomes visible. The owner's
     * SMTP account has a daily cap (mail plan §10), and the failure mode is
     * silent: the provider starts refusing partway through a digest sweep and
     * every subsequent email that morning is lost. A count on this table is
     * what turns that into something somebody can see.
     *
     * ## Append-only, like audit_logs
     *
     * A delivery row is a record of something that happened in the world.
     * `status` moves queued to sent or failed exactly once, written by the
     * channel that owns the send; nothing else updates a row and nothing
     * deletes one. `MailDelivery` enforces it.
     */
    public function up(): void
    {
        Schema::create('mail_deliveries', function (Blueprint $table) {
            $table->id();

            /*
             * Nullable, and nullOnDelete rather than cascade — the opposite
             * of `notifications`, for the opposite reason.
             *
             * A notification with no recipient is addressed to nobody and is
             * not a record of anything, so it goes when the user goes. A
             * delivery row *is* the record: "we sent this invoice to this
             * address on this date" has to survive the account being closed,
             * because that is precisely when somebody disputes it.
             *
             * Nullable also because not every send has a user behind it. The
             * settings screen test send goes to a typed-in address, and an
             * invitation is mailed to an address before its account is worth
             * anything.
             */
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

            /*
             * Nullable for the same reason audit_logs' is: platform-level
             * sends exist outside any tenant. Taken from the recipient at
             * send time, never from TenantContext — a queue worker never
             * passes through IdentifyTenant, so the ambient tenant inside a
             * worker is whatever the last job left bound (see
             * TenantDatabaseChannel, which learned this the same way).
             */
            $table->foreignId('tenant_id')->nullable()->constrained()->nullOnDelete();

            /*
             * The fleet whose operations this email is about, where there is
             * one. Not who it was sent to — who it concerns.
             *
             * This column is what makes the mail plan §6 rule auditable
             * rather than merely intended: *an email about a fleet's
             * operations goes to that fleet and to nobody else*. With it, a
             * cross-fleet leak is a query. Without it, it is an incident
             * report.
             */
            $table->foreignId('operator_id')->nullable()->constrained()->nullOnDelete();

            /*
             * The address the mail actually went to, denormalised on purpose.
             *
             * Reading it back through `user_id` would answer where the mail
             * would go *today*, which is the wrong question and quietly
             * rewrites history the moment somebody changes their address.
             * The dispute is always about the address at the time.
             */
            $table->string('recipient', 190);

            /* The stable name from NotificationType, or a "system." name for
             * the sends that are not notifications (the settings test send,
             * an invitation). Plain varchar for the same reason
             * `notifications.type` is: a new email must not need a DDL
             * change. */
            $table->string('type');

            /* Frozen at send time. What the recipient actually saw in their
             * inbox list, not what the template would render now. */
            $table->string('subject');

            $table->string('status', 16)->default('queued');

            /* The transport's own words. Kept because "failed" without why is
             * a support call, which is the same argument the settings screen
             * test send makes when it surfaces the SMTP error verbatim. */
            $table->text('error')->nullable();

            /* Queue attempt this row was written on. A row that reads 3 is a
             * mail server that refused twice. */
            $table->unsignedTinyInteger('attempts')->default(0);

            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            /* "Everything sent to this person, newest first" — the support
             * question this table exists to answer. */
            $table->index(['recipient', 'created_at']);

            /* "What is failing, and since when." Also the daily-cap query:
             * count sent rows in a window. */
            $table->index(['status', 'created_at']);

            $table->index(['type', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_deliveries');
    }
};
