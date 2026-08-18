<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Modules\Drivers\Enums\DriverApplicationStatus;

return new class extends Migration
{
    /**
     * The queue a rider puts themselves in (ADR-0027).
     *
     * Not a `users` row and not a `drivers` row, for reasons ADR-0027 §1
     * argues at length: an applicant has no credentials on this platform
     * until somebody approves them, and `drivers` needs a licence number
     * this table's contents are not trusted to supply.
     */
    public function up(): void
    {
        Schema::create('driver_applications', function (Blueprint $table) {
            $table->id();

            $table->string('name');
            // Required, and the only channel that works today: approval is
            // announced by telephone because SMTP is ADR-0014 phase 3.
            $table->string('phone');
            $table->string('email');

            /**
             * The applicant's own choice, hashed at submission and carried
             * to the account at approval — never re-typed, never emailed,
             * never known to the approver (ADR-0027 §3).
             *
             * Nullable because it is cleared once the application is
             * decided: after approval the live copy is on `users`, and
             * after rejection nobody should be holding a stranger's
             * credential at all.
             */
            $table->string('password')->nullable();

            $table->string('status')->default(DriverApplicationStatus::PENDING->value);

            /**
             * Consent, as a timestamp rather than a boolean.
             *
             * Uganda's Data Protection and Privacy Act, 2019 wants consent
             * recorded. "true" records that a checkbox was submitted; a
             * time records when a person agreed, which is the thing anybody
             * asking would actually want to know.
             */
            $table->timestamp('terms_accepted_at');

            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('rejection_reason')->nullable();

            // Set on approval, so the queue can show what became of a row.
            // nullOnDelete rather than cascade: a driver profile deleted
            // later must not take the record of their application with it.
            $table->foreignId('driver_id')->nullable()->constrained('drivers')->nullOnDelete();

            $table->timestamps();

            /**
             * Deliberately NOT unique on email.
             *
             * ADR-0027 §5: the public endpoint answers identically whether
             * or not the address is already known, so that it cannot be
             * used to ask "does this person drive for KangaruRide". A
             * unique index would turn every duplicate into a 422 and hand
             * out exactly that answer. Duplicates are refused at approval,
             * where a human is reading them.
             */
            $table->index(['status', 'created_at']);
            $table->index('email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_applications');
    }
};
