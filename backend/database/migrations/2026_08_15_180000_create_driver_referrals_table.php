<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who introduced whom, and whether it has been paid for (ADR-0037).
 *
 * Three schema decisions carry the whole scheme's integrity, so each is
 * written down here rather than left to the service that reads them.
 *
 * **`referred_driver_id` is unique.** A driver can be introduced once, ever.
 * Without it a second application from the same person — which ADR-0027 §5
 * deliberately allows to be *submitted*, because refusing a duplicate would
 * turn the form into a way of asking "does this person drive for
 * KangaruRide" — could be approved against a second code and pay a second
 * reward for one recruit.
 *
 * **`code` is frozen onto the row.** `drivers.referral_code` is where a code
 * lives today; this is which code was actually used, so a driver's code
 * changing tomorrow cannot restate who introduced whom. Same argument
 * ADR-0029 §3 makes for writing the commission rate into a ledger entry.
 *
 * **The reward figures are frozen too.** `trip_target` and `amount_minor` are
 * admin-settable, and a referral explained only by "the current reward" is one
 * nobody can defend a year later.
 *
 * `drivers.referral_code` and `driver_applications.referral_code` are added
 * here rather than in migrations of their own: the three are one feature and
 * splitting them leaves two intermediate states in which the scheme is half
 * present.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_referrals', function (Blueprint $table) {
            $table->id();

            // Who gets paid.
            $table->foreignId('referrer_driver_id')->constrained('drivers')->cascadeOnDelete();

            // Who they introduced. Unique — see the docblock; this is the
            // guard, not a convention the service promises to honour.
            $table->foreignId('referred_driver_id')->constrained('drivers')->cascadeOnDelete();
            $table->unique('referred_driver_id');

            // The code as it was used, frozen.
            $table->string('code', 16);

            // What the rule promised when the referral was attached.
            $table->unsignedInteger('trip_target');
            $table->unsignedBigInteger('amount_minor');
            $table->string('currency', 3);

            // Null until the referred driver clears the target. Stamping this
            // and writing the ledger entry happen in one transaction, so a row
            // with a timestamp and no entry cannot exist.
            $table->timestamp('qualified_at')->nullable();

            $table->foreignId('ledger_entry_id')
                ->nullable()
                ->constrained('driver_ledger_entries')
                ->nullOnDelete();

            $table->timestamps();

            // The scan that looks for referrals still owed reads exactly this:
            // one referrer's rows, and the unqualified ones across the fleet.
            $table->index(['referrer_driver_id', 'qualified_at']);
        });

        Schema::table('drivers', function (Blueprint $table) {
            // Nullable, and minted on demand rather than at driver creation:
            // every driver who existed before this migration would otherwise
            // need backfilling, and a code nobody has ever looked at is a
            // string taking up an index.
            $table->string('referral_code', 16)->nullable()->unique()->after('id');
        });

        Schema::table('driver_applications', function (Blueprint $table) {
            // What the applicant typed, unvalidated and unresolved. It is
            // checked when the office approves them (ADR-0037 §5) — validating
            // at submission would answer "is this a real driver's code?" to an
            // unauthenticated caller, which is the same leak ADR-0027 §5
            // refuses for the email address.
            $table->string('referral_code', 16)->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('driver_applications', function (Blueprint $table) {
            $table->dropColumn('referral_code');
        });

        Schema::table('drivers', function (Blueprint $table) {
            $table->dropUnique(['referral_code']);
            $table->dropColumn('referral_code');
        });

        Schema::dropIfExists('driver_referrals');
    }
};
