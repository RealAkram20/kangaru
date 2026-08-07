<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A driver's weekly roster (ADR-0017 §3): the hours they work.
     *
     * The inverse of `availability_blocks`. A block says "not this
     * Tuesday"; a shift window says "Tuesdays, 06:00 to 18:00, every week".
     * Both are needed: leave is an exception to a roster, and expressing a
     * roster as fifty-two weeks of blocks is not a roster.
     *
     * **A driver with no rows is available at any hour.** That is what makes
     * this additive: every driver in the system today has no rows, and
     * dispatch behaves for them exactly as it did before this table
     * existed. Rostering is opt-in per driver, which is also how a fleet
     * adopts it — one depot at a time, not in a single cutover.
     *
     * Times are local wall-clock in the platform's configured timezone
     * (`settings.regional.timezone`), stored as TIME rather than as an
     * offset. A shift is "six in the morning" to the person driving it, and
     * stays six in the morning across a DST change; storing an instant
     * would silently move it.
     */
    public function up(): void
    {
        Schema::create('driver_shift_windows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();
            // 0 = Sunday … 6 = Saturday, matching Carbon's dayOfWeek so no
            // translation layer can get it off by one.
            $table->unsignedTinyInteger('weekday');
            $table->time('starts_at');
            // May be earlier than `starts_at`, which means the shift runs
            // past midnight into the next day — a night shift is normal in
            // this business, and forbidding it would force operators to
            // split every one into two rows that no longer read as one
            // shift.
            $table->time('ends_at');
            $table->timestamps();

            $table->index(['driver_id', 'weekday']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_shift_windows');
    }
};
