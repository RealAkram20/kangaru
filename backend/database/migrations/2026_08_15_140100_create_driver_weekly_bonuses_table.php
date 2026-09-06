<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per driver per week a bonus was awarded for (ADR-0034 §4, §5).
 *
 * **This table exists to be a unique index.** The bonus itself lives in
 * `driver_ledger_entries` like every other credit; what the ledger cannot
 * answer on its own is *"has this driver already been paid for the week of
 * 10 August?"* — the entries carry a description and a timestamp, and
 * matching on either is the kind of guard that works until somebody edits the
 * wording.
 *
 * A scheduled command can fire twice: a cron that overlaps a deploy, a manual
 * re-run after a failure, two app servers with the same schedule. Paying a
 * driver twice for one week is exactly the class of error nobody notices until
 * reconciliation, and `(driver_id, week_start)` makes the second attempt an
 * integrity error rather than a silent second payment. Same precedent as
 * `driver_ledger_entries`' `(trip_id, kind)` index, which does this job for
 * trip completion.
 *
 * `week_start` is a **date, in the fleet's timezone**, not a timestamp.
 * `settings.regional.timezone` decides where a week begins; storing an instant
 * would make the same Kampala week key differently depending on the server's
 * clock, and `config/app.php` is UTC.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_weekly_bonuses', function (Blueprint $table) {
            $table->id();

            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();

            // The Monday of the week this rewards, in the fleet's local zone.
            $table->date('week_start');

            // What the rule saw, frozen. The settings behind it are
            // admin-settable, so a bonus explained only by "the current
            // target" is a bonus nobody can defend a year later — the same
            // argument ADR-0029 §3 makes for writing the commission rate into
            // an entry's description rather than recomputing it.
            $table->unsignedInteger('trips_completed');
            $table->unsignedInteger('trip_target');
            $table->unsignedBigInteger('amount_minor');
            $table->string('currency', 3);

            // The credit this produced. Nullable only so the row can be
            // written in the same transaction as the entry it points at.
            $table->foreignId('ledger_entry_id')
                ->nullable()
                ->constrained('driver_ledger_entries')
                ->nullOnDelete();

            $table->timestamps();

            // The whole reason this table exists. See the docblock.
            $table->unique(['driver_id', 'week_start']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_weekly_bonuses');
    }
};
