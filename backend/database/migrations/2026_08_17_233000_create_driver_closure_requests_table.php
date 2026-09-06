<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A driver asking for their account to be closed (ADR-0043).
     *
     * **Closing is not deleting**, and this table is the record of the ask
     * rather than of an erasure. Confirming a row deactivates the driver and
     * detaches their sign-in; it touches no trip, no ledger entry, no invoice
     * and no audit row, because `master-plan.md` §6 stakes the product on those
     * staying reproducible.
     */
    public function up(): void
    {
        Schema::create('driver_closure_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            $table->string('status', 20)->default('pending');

            /**
             * The driver's own words, and optional.
             *
             * Optional because requiring somebody to justify leaving is a
             * dark pattern, and a mandatory box produces "." far more often
             * than it produces a reason. The office reads it where it is
             * given.
             */
            $table->string('reason', 500)->nullable();

            // Who answered, when, and why they said no. A decline with no
            // reason is how a driver stops using a feature (ADR-0032).
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->string('decline_reason', 500)->nullable();

            /**
             * When the account actually closed.
             *
             * **The clock the retention sweep runs on** (ADR-0043 §3): the
             * master plan anonymises ex-employee accounts after 90 days, and
             * this is what those 90 days are measured from. Null unless the
             * request was confirmed — a declined or withdrawn request never
             * closed anything and must not start a retention clock.
             *
             * The sweep itself is **not built** and is W1-e's retention work.
             * This column is the event it needs, and its absence would leave
             * that work nothing to key on.
             */
            $table->dateTime('closed_at')->nullable();

            $table->timestamps();

            /*
             * Not a unique key on `driver_id`: a driver whose request was
             * declined must be able to ask again after settling whatever the
             * office objected to. "One *open* request" is a rule about status,
             * which the database cannot express here, so the service enforces
             * it — and its test is what holds it.
             */
            $table->index(['driver_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_closure_requests');
    }
};
