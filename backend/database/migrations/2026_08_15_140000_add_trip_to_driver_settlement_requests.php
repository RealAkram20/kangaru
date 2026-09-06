<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A settlement request can now name the trip it is about (ADR-0034 §1).
 *
 * Only tip declarations do. A remittance is a bag of cash covering a day's
 * work and a payout is a request against a balance; neither belongs to one
 * journey. A tip does — the passenger on *that* trip handed it over — and
 * without the link the office is confirming an amount with no way to check it
 * against anything.
 *
 * **Nullable, and it has to be.** The column arrives on a table that already
 * holds remittances and payouts, and backfilling those with a trip would be
 * inventing a fact. `SettlementRequestKind::requiresTrip()` is where the "a
 * tip must have one" rule lives, because it is a rule about kinds rather than
 * about the column.
 *
 * `nullOnDelete`: a trip removed from under a declaration leaves the amount
 * and the office's decision intact. Losing a confirmed money record because
 * its trip was tidied away would be the worse failure by far.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('driver_settlement_requests', function (Blueprint $table) {
            $table->foreignId('trip_id')
                ->nullable()
                ->after('driver_id')
                ->constrained('trips')
                ->nullOnDelete();

            // The lookup `raise()` makes under its lock: "does this driver
            // already have an open declaration for this trip?" Without it that
            // check is a scan of the driver's whole request history on every
            // declaration.
            $table->index(['driver_id', 'trip_id']);
        });
    }

    public function down(): void
    {
        Schema::table('driver_settlement_requests', function (Blueprint $table) {
            $table->dropIndex(['driver_id', 'trip_id']);
            $table->dropConstrainedForeignId('trip_id');
        });
    }
};
