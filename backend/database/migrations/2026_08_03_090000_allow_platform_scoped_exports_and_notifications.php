<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0007: a report can be about every client, so the row recording it and
 * the notification announcing it can belong to none.
 *
 * `report_exports.tenant_id` and `notifications.tenant_id` become nullable,
 * where null means **platform scope** — the whole platform, deliberately —
 * and never "unknown" or "not set yet". Both columns are only ever written
 * from a resolved `ReportScope` or from a recipient who is platform staff.
 *
 * This is not a new idea in the schema. `audit_logs.tenant_id` is already
 * nullable for exactly this reason: ADR-0004's role catalogue is
 * platform-wide, so a role change belongs to no client, and the notifications
 * migration says so in its own comment while taking the opposite choice for
 * itself. That choice was right when every notification followed a client's
 * booking; it stopped being right when platform staff got work of their own.
 *
 * ## Why this does not widen anybody's reads
 *
 * `TenantScope` filters `where tenant_id = <bound>`, which never matches
 * null. So a client cannot see a platform-scoped export or notification by
 * any query that goes through the scope — the rows are invisible to them
 * for the same reason another client's are, and no new predicate is needed
 * to keep them out. Platform staff reach their own through `forActor()`,
 * and in the notification case `scopeFor` narrows to `user_id` first, so
 * "no tenant" never means "everyone's inbox".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_exports', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable()->change();
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable()->change();
        });
    }

    /**
     * Reversible, with one honest caveat that belongs in the PR rather than
     * in a fake `down()`: rows written while the column was nullable have no
     * tenant to restore, and a non-nullable column cannot hold them. They
     * are deleted here.
     *
     * That is safe for precisely these two tables and would not be for most.
     * A `report_exports` row is a receipt for a file that is pruned after
     * seven days anyway, and a `notifications` row is a message about work
     * that happened elsewhere. Neither is a financial record and neither is
     * the only copy of anything — AGENTS.md's append-only rule is about
     * invoices and audit rows, not these.
     */
    public function down(): void
    {
        // Before the column can refuse null again, the rows that rely on it
        // have to go. Ordered before the schema change, or the ALTER fails
        // on exactly the data this migration made possible.
        DB::table('report_exports')->whereNull('tenant_id')->delete();
        DB::table('notifications')->whereNull('tenant_id')->delete();

        Schema::table('report_exports', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable(false)->change();
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->foreignId('tenant_id')->nullable(false)->change();
        });
    }
};
