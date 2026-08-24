<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which emails this deployment sends at all. One row per type switched
     * **off**, platform wide, by a system administrator.
     *
     * ## Two switches, and they are not the same switch
     *
     * `mail_preferences` is a *person* saying "not to me". This is the
     * *platform* saying "not at all, by anyone". They compose: an email needs
     * both to be on, and either one being off is enough to stop it.
     *
     * Conflating them was the tempting shortcut and it breaks in both
     * directions. A platform toggle stored per user would have to be written
     * across every account and rewritten for every new account. A per-user
     * preference read as a platform default would let one dispatcher's choice
     * decide what a colleague receives.
     *
     * ## Rows mean off, same as mail_preferences
     *
     * A row per type written at install would make adding a notification a
     * backfill, and would make a deployment that skipped that backfill
     * silently opted out of something nobody decided. Absence means on, which
     * is the state a new email should arrive in.
     *
     * ## Not every type may appear here
     *
     * `NotificationType::mailIsRequired()` decides, and the service refuses
     * rather than accepting a row and ignoring it. Security and money emails
     * are not switchable: a platform that has turned off "your password was
     * changed" has turned off the only warning an account holder will get that
     * somebody else is holding their account, and a system administrator
     * clicking that switch would not be the person harmed by it.
     *
     * ## Deliberately not in the settings table
     *
     * `SettingsService` keeps a whitelisted catalogue of keys, and sixty
     * notification types would triple it while making the catalogue drift from
     * the enum every time a type is added. The enum is the catalogue here, and
     * this table only records departures from it.
     */
    public function up(): void
    {
        Schema::create('mail_toggles', function (Blueprint $table) {
            $table->id();

            /* The stable name from NotificationType. Unique because "off"
             * twice is still off, and a double-click on a switch must not
             * leave two rows saying the same thing. */
            $table->string('type')->unique();

            /* Who turned it off, so the question "why does nobody get invoice
             * emails" has an answer that is a person rather than a mystery.
             * nullOnDelete: the switch outlives the administrator who threw
             * it, which is exactly when somebody starts asking. */
            $table->foreignId('disabled_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_toggles');
    }
};
