<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0009: exclusivity is a property of a contract, not of allocation.
 *
 * ADR-0005 created `vehicle_allocations` to say "supplied to the Bank"
 * without saying "owned by the Bank". It did not say whether being allocated
 * *excludes* anybody, and the argument for making it always exclude rested
 * on the anchor contract demanding it. Read again, `CRDB/CS/F/26` requires
 * that the vehicles used for the Bank's work carry telematics. It is not an
 * exclusivity clause.
 *
 * So the default is **false**: a vehicle contracted to a client ranks first
 * for that client's work and remains available to everyone else's. That is
 * the Bank's case, and it is what keeps an allocated vehicle able to take
 * the hailing work PROJECT.md's Phase 3 describes.
 *
 * `true` is a real thing some clients will pay for — the vehicle may be
 * dispatched only on that tenant's trips for the period — and modelling it
 * per row is what lets the sales conversation decide, rather than forcing
 * every client into whichever answer the last argument produced.
 *
 * ## Additive, per AGENTS.md's zero-downtime rule
 *
 * A new column with a default, no backfill job and no constraint change.
 * Existing rows become explicitly non-exclusive, which is what they already
 * meant by implication — nothing consulted them, so nothing changes
 * behaviour on deploy.
 *
 * ## What this column does NOT do
 *
 * It does not enforce the overlap rule. "An exclusive allocation may not
 * overlap any other allocation for the same vehicle" is a range predicate
 * across rows, and MySQL 8 cannot express it: there is no exclusion
 * constraint (that is PostgreSQL's `EXCLUDE USING gist`), a `UNIQUE` index
 * cannot describe a range, and a `CHECK` cannot see other rows. The rule
 * lives in `Modules\Fleet\Services\AllocationService` under a row lock, and
 * its race test is the only thing holding it — see ADR-0009 §4.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_allocations', function (Blueprint $table) {
            $table->boolean('exclusive')->default(false)->after('ends_on');
        });
    }

    public function down(): void
    {
        Schema::table('vehicle_allocations', function (Blueprint $table) {
            $table->dropColumn('exclusive');
        });
    }
};
