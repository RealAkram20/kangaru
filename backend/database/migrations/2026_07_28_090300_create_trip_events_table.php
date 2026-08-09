<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('trip_events', function (Blueprint $table) {
            $table->id();
            // Unlike audit_logs.tenant_id, a Trip is always tenant-owned
            //
            // NO LONGER TRUE. ADR-0024 gave trips a second kind of owner —
            // a walk-in customer — and this column became nullable in
            // `2026_08_09_090100_allow_tenantless_trip_evidence`. Left in
            // place rather than rewritten, because the reasoning below is
            // still why it was NOT NULL for the first year, and a comment
            // that quietly changes its mind teaches nobody why.
            // (never platform-level), so non-nullable is correct here.
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('trip_id')->constrained()->cascadeOnDelete();
            // Null only for the initial Assigned event (no "from" state).
            $table->string('from_status')->nullable();
            $table->string('to_status');
            // Nullable: today every event has an actor, but a future
            // scheduled No Show job (deferred) will write system events.
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            // Append-only: created_at only, no updated_at column — mirrors
            // audit_logs exactly.
            $table->timestamp('created_at')->useCurrent();

            $table->index(['tenant_id', 'trip_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trip_events');
    }
};
