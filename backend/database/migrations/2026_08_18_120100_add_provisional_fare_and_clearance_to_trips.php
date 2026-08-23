<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The kerb, and the review queue (ADR-0045 §§2, 5; Phase 2 of
 * `docs/measured-distance-plan.md`).
 *
 * **The kerb.** A walk-in fare is now settled *after* the trip's distance is
 * resolved — a grace period and a queue hop after Trip Completed — but a
 * cash passenger pays at the kerb. So the handset sends the distance it
 * measured from its own buffered pings with the completion
 * (`provisional_distance_km`), the server prices it through the ordinary
 * engine at once (`fare_provisional_minor`), and that is the figure the
 * driver shows and takes. The settled fare replaces it as the trip's fare
 * when the resolver has spoken; the provisional figure stays beside it so a
 * difference is visible, and it is what the driver's ledger records as cash
 * collected — because it is what was collected.
 *
 * Both nullable. A trip completed from the console, or by a handset that
 * predates the field, has no provisional distance; under the `odometer`
 * policy the provisional fare is priced from the odometer delta instead, so
 * a driver still has a number to show.
 *
 * **The review queue.** A trip graded C is held: no invoice, no ledger pair,
 * until a person with `trips.transition.finance` clears it with a reason.
 * The clearance is recorded on the trip and audited like every other money
 * act; the evidence row it overrules is untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->decimal('provisional_distance_km', 8, 2)->nullable()->after('distance_resolved_at');
            $table->unsignedBigInteger('fare_provisional_minor')->nullable()->after('provisional_distance_km');
            $table->timestamp('distance_cleared_at')->nullable()->after('fare_provisional_minor');
            $table->foreignId('distance_cleared_by_user_id')->nullable()->after('distance_cleared_at')
                ->constrained('users')->nullOnDelete();
            $table->string('distance_cleared_reason', 500)->nullable()->after('distance_cleared_by_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('distance_cleared_by_user_id');
            $table->dropColumn([
                'provisional_distance_km',
                'fare_provisional_minor',
                'distance_cleared_at',
                'distance_cleared_reason',
            ]);
        });
    }
};
