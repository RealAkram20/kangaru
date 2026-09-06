<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The sibling column `create_dispatch_offers_table` promised (ADR-0068).
 *
 * That migration left `order_request_id` nullable and said so in as many
 * words: *"When a booking-shaped offer arrives it is a sibling column, not a
 * reinterpretation of this one."* This is that arrival. A desk assignment
 * now rings the driver exactly as a walk-in does, so an offer has two
 * possible owners and carries whichever one it was raised for.
 *
 * ## Why the owner is a column rather than a polymorphic pair
 *
 * `order_request_id` is already a real foreign key with a real cascade, and
 * a `morphs()` conversion would trade that for a string nobody can constrain
 * — on the one table whose correctness ADR-0024 §5 rests on. Two nullable
 * foreign keys keep both cascades honest and make the exclusivity a thing
 * the database itself can be asked about. The XOR is asserted in
 * `DispatchOffer::booted()`, where the mistake is legible, for the reason
 * `TripService` asserts the same shape about a trip's two owners rather than
 * leaving it to a constraint nobody reads.
 *
 * ## The index
 *
 * `['booking_id', 'status']` mirrors the order-request index beside it and
 * answers the same question for the desk: *is this booking still out with
 * somebody, and has it come back*. The board asks it on every poll.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            // cascadeOnDelete, matching `order_request_id`: an offer
            // describes a decision about a job, and a job that no longer
            // exists has no decisions worth keeping. The driver-side history
            // that *is* worth keeping lives on `trips`, which this table
            // points at rather than owns.
            $table->foreignId('booking_id')
                ->nullable()
                ->after('order_request_id')
                ->constrained()
                ->cascadeOnDelete();

            // ADR-0009's audit, carried across the wait.
            //
            // A dispatcher who passes over a vehicle contracted to the
            // client owes a written reason, and `trips` has always stored
            // it. It could, because the desk's press created the trip. Now
            // the press creates an *offer* and the trip appears when a
            // driver answers — minutes later, in another request — so
            // without somewhere to keep it the reason would be collected,
            // validated, and dropped on the floor.
            //
            // Only round one can carry one: it is the reason a *person* gave
            // for a pair they chose by hand. A rotation wave is filtered to
            // contracted and main-fleet vehicles precisely so that it never
            // needs one.
            $table->string('allocation_override_reason', 500)->nullable();

            $table->index(['booking_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            // This order is load-bearing on MySQL, and the obvious order
            // fails. InnoDB lets a foreign key be backed by *any* index
            // whose leftmost column is the key, so it adopts the composite
            // `['booking_id', 'status']` above and then refuses to drop it:
            // "Cannot drop index … needed in a foreign key constraint"
            // (errno 1553). The constraint has to go first, then the index
            // it was leaning on, then the column.
            $table->dropForeign(['booking_id']);
            $table->dropIndex(['booking_id', 'status']);
            $table->dropColumn(['booking_id', 'allocation_override_reason']);
        });
    }
};
