<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One row per user per notification type they have switched **off**.
     *
     * ## Rows mean "off", and absence means "on"
     *
     * The alternative — a row per user per type, written at sign-up — makes
     * adding a notification type a backfill, and makes a user created before
     * that backfill silently opted out of something they never declined. The
     * sparse table has one meaning and it is the meaningful one: this person
     * asked us to stop.
     *
     * ## Not every type may appear here
     *
     * `NotificationType::mailIsRequired()` decides, and the service refuses a
     * row for a required type rather than accepting it and ignoring it. A
     * preference the platform stores and then overrides is worse than no
     * preference at all: the user reads the switch as an answer.
     *
     * Required means security or money — a password reset, a payout account
     * change, an invoice. AGENTS.md's "avoid notification fatigue" is about
     * the noise around those, not about them.
     */
    public function up(): void
    {
        Schema::create('mail_preferences', function (Blueprint $table) {
            $table->id();

            /* cascadeOnDelete: a preference is a property of the account, not
             * a record of anything. It goes when the account goes. This is
             * the case `mail_deliveries` deliberately is not. */
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('type');

            $table->timestamps();

            /* The pair is the identity. `firstOrCreate` on it is the whole
             * write path, and a double-click must not leave two rows saying
             * the same thing. */
            $table->unique(['user_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_preferences');
    }
};
