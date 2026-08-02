<?php

use App\Enums\UserStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Gives an account a usable/not-usable state so staff can be onboarded
     * and off-boarded.
     *
     * Additive with a default, per the zero-downtime rule: every existing
     * row becomes `active`, which is what they were in effect, so no
     * backfill job and no window where an account cannot log in because a
     * column it needs is null.
     *
     * `deactivated_at` is separate from the status rather than derived from
     * `updated_at`, because AGENTS.md Compliance requires "ex-employee
     * accounts anonymized 90 days after deactivation" — that clock needs a
     * timestamp of its own, and any later edit would reset `updated_at` and
     * silently restart it.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Plain varchar, matching users.role and for the same reason:
            // a native ENUM makes adding a state a full table rewrite.
            $table->string('status')->default(UserStatus::ACTIVE->value)->after('role');
            $table->timestamp('deactivated_at')->nullable()->after('status');

            // Staff lists are always "this tenant's users", usually filtered
            // by status. tenant_id already has its own index for the login
            // path; this serves the listing.
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Index dropped before its columns. MySQL 8 will refuse to drop
            // a column an index still covers, and CI runs this down().
            $table->dropIndex(['tenant_id', 'status']);
            $table->dropColumn(['status', 'deactivated_at']);
        });
    }
};
