<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which fleet is the house, and may take corporate work without a contract.
 *
 * The owner, 29 August 2026: *"shanitah is the main fleet that has got all the
 * access to both walking and Coporate, the other just need to request another
 * contract."*
 *
 * ## What this changes about ADR-0009
 *
 * Automatic dispatch commits a **contracted** vehicle or nothing. That rule
 * exists so a client paying to have vehicles set aside is not passed over for
 * somebody else's van that happened to be nearer, and it stays exactly as it
 * is for every fleet that arrived on the platform to serve a particular
 * client. It was never meant to describe the house fleet, which is the
 * platform's own operation and predates the idea of contracting to it: before
 * ADR-0055 gave the fleets identities, Shanitah *was* the platform, and a
 * contract between the house and a client it already serves is paperwork with
 * nothing on either side of it.
 *
 * The flag is what tells those two apart. Without it the only way to let the
 * house serve a client was to write it a contract per client — which is what
 * was done on 28 August to get a boda dispatchable, and which has to be
 * repeated for every client the house takes on.
 *
 * ## A column, not a constant
 *
 * `Operator::class` documents that Shanitah is row 1, inserted by the
 * migration that creates the table, and six backfills name that id. Keying the
 * rule on `id === 1` would work today and would be wrong the moment the
 * platform is run by somebody whose fleet was created second — a white-label
 * deployment, or Shanitah being reorganised into a new company. This is a
 * property of a fleet, so it is stored on the fleet.
 *
 * More than one row may carry it. That is not a mistake to guard against: two
 * house fleets is a coherent arrangement (a second region, a second brand),
 * and a unique constraint would only make the coherent case unrepresentable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('operators', function (Blueprint $table) {
            $table->boolean('is_main_fleet')
                ->default(false)
                ->after('status');
        });

        // Row 1 by identity, not by convenience: this is the operator the
        // `operators` migration inserted for the platform's own fleet, and it
        // is the one the owner means by "the main fleet". Every fleet created
        // afterwards arrives to serve a client and contracts for the work.
        DB::table('operators')->where('id', 1)->update(['is_main_fleet' => true]);
    }

    public function down(): void
    {
        Schema::table('operators', function (Blueprint $table) {
            $table->dropColumn('is_main_fleet');
        });
    }
};
