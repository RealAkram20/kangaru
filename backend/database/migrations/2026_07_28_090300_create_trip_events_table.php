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
