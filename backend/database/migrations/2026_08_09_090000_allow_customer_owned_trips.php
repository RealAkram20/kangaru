<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0024 §1: a walk-in trip is owned by a customer, not by a tenant.
 *
 * `trips.tenant_id` has been a non-nullable foreign key since the table was
 * created, which encodes an assumption that stopped being true the moment
 * ADR-0012 let a stranger order transport: every trip in this system belongs
 * to a corporate client, and a walk-in's ride has nowhere to live.
 *
 * The alternative — a "walk-in" pseudo-tenant every such trip points at —
 * was rejected for the reason ADR-0012 rejected it for `order_requests`: a
 * fake row is visible to every screen, every report and every scope, and
 * each of them then has to know to exclude it forever. A null tenant is
 * honest. There is no tenant, and the column says so.
 *
 * This is the same shape as `drivers`, `vehicles`, `order_requests` and
 * `customers` before it (ADR-0005): platform-owned rows carry no tenant.
 * `TenantScope` fails closed, so a walk-in trip is invisible to every
 * corporate client by construction rather than by a predicate somebody has
 * to remember to write.
 *
 * **Nothing is backfilled and nothing changes for existing rows.** Every
 * trip that predates this has a tenant and keeps it; the column merely stops
 * insisting.
 *
 * There is deliberately no CHECK constraint asserting that exactly one owner
 * is set. `TripService` is the only writer and asserts it there, following
 * the precedent the `customers` migration set for its own
 * two-nullable-credentials rule — an invariant belongs where it is readable.
 * What actually guarantees the isolation is the mandatory cross-tenant suite,
 * extended in both directions by this change.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Dropped and re-added rather than altered in place: `change()` on a
        // column carrying a foreign key needs the constraint gone first on
        // MySQL/MariaDB, and re-adding it is how the referential guarantee
        // comes back rather than being quietly lost.
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable()->change();
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();

            // The other owner. `restrictOnDelete`, unlike the tenant's
            // cascade, and the asymmetry is deliberate: deleting a client
            // company is an administrative act on the platform's own
            // records, while a customer's completed trips are the evidence
            // behind a fare they paid. A customer row with trip history
            // must not be removable without somebody dealing with the
            // history first — the same reasoning the vehicle and driver
            // foreign keys on this table carry.
            $table->foreignId('customer_id')
                ->nullable()
                ->after('tenant_id')
                ->constrained('customers')
                ->restrictOnDelete();

            // The driver app's own listing and the customer's ride poll both
            // read by owner, and the existing index leads with tenant_id,
            // which is null for every row either of them wants.
            $table->index(['customer_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
            $table->dropIndex(['customer_id', 'status']);
            $table->dropColumn('customer_id');
        });

        // Rows with no tenant cannot survive the column becoming NOT NULL
        // again, and there is no honest tenant to give them. Refuse rather
        // than invent one or delete somebody's trip history.
        $orphans = DB::table('trips')->whereNull('tenant_id')->count();

        if ($orphans > 0) {
            throw new RuntimeException(
                "Cannot roll back: {$orphans} customer-owned trip(s) have no tenant to return to. "
                .'Deal with them explicitly before reversing ADR-0024.'
            );
        }

        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable(false)->change();
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
    }
};