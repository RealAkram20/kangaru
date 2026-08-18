<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The foreign key `OrderRequestStatus::CONVERTED` was promised (ADR-0024 §4).
 *
 * That enum's docblock has carried the promise since ADR-0012:
 *
 * > `CONVERTED` records that the request became real-world work. It does not
 * > link to a Trip or Booking — both are tenant-owned, and walk-in
 * > fulfilment is deferred to its own ADR. When that lands, this case gains
 * > a foreign key rather than a new meaning.
 *
 * This is that ADR and this is that foreign key. The case keeps its meaning
 * exactly; it simply now says *which* work.
 *
 * The blocker it named is gone: trips stopped being tenant-owned in
 * `2026_08_09_090000_allow_customer_owned_trips`, so a walk-in's trip is a
 * row this table can honestly point at.
 *
 * Nullable, and null for the overwhelming majority of rows: an order the
 * desk closed, an order still being searched for, and every order that
 * predates this. `nullOnDelete` rather than cascade — a trip being
 * soft-deleted must not take the record of the customer's request with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            $table->foreignId('trip_id')
                ->nullable()
                ->after('customer_id')
                ->constrained()
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            $table->dropForeign(['trip_id']);
            $table->dropColumn('trip_id');
        });
    }
};
