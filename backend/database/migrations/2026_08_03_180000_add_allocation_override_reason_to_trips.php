<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0009 §1: an allocation ranks, and a dispatcher who goes past the
 * ranking says why.
 *
 * "Allocated vehicles first" with a silent override is a suggestion nobody
 * can audit afterwards. With a recorded reason, *"why was the Bank's
 * contracted vehicle not used on the 14th"* becomes a question the platform
 * can answer — the same instinct that produced the audit log, applied to a
 * dispatch choice.
 *
 * Null is the ordinary case and means no override happened: either the
 * client had no vehicle contracted for that day, or the one dispatched was
 * theirs. It never means "a reason was not given" — the reason is required
 * at the point the override occurs, so a null here is a positive statement
 * that nothing was overridden.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->text('allocation_override_reason')->nullable()->after('driver_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('allocation_override_reason');
        });
    }
};
