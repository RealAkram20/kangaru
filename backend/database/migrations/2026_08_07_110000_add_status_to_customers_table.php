<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whether a customer account may still be used (ADR-0018 §3).
     *
     * The platform had no way to stop one. A walk-in account that places
     * abusive orders, runs up unpaid rides, or turns out to be somebody
     * impersonating a real customer could be deleted — losing the order
     * history that is the evidence — or left alone. Neither is an answer.
     *
     * `active` by default, so every existing row keeps working and no
     * backfill is needed: this is additive in the sense AGENTS.md's
     * zero-downtime rule means.
     *
     * The reason is stored beside the flag rather than left to the audit
     * log alone, because the person who has to answer "why can't I sign
     * in?" on the phone needs it in front of them, not in a query.
     */
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('status', 16)->default('active')->after('google_id');
            $table->dateTime('suspended_at')->nullable()->after('status');
            $table->string('suspension_reason', 255)->nullable()->after('suspended_at');
            $table->foreignId('suspended_by_user_id')->nullable()->after('suspension_reason')
                ->constrained('users')->nullOnDelete();

            // The register's default view is "everyone, newest first"; the
            // one filter it will always have is status.
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('suspended_by_user_id');
            $table->dropIndex(['status', 'created_at']);
            $table->dropColumn(['status', 'suspended_at', 'suspension_reason']);
        });
    }
};
