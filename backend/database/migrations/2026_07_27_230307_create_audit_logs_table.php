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
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            // Deliberately nullable, unlike ordinary tenant-owned tables (ADR-0001) —
            // some audited actions (Super Admin creating a Company before it has an
            // owning context, future console/system actions) are platform-level or
            // pre-tenant. audit_logs is observability infra, not tenant-owned data.
            $table->foreignId('tenant_id')->nullable()->constrained()->nullOnDelete();
            // Nullable: audit rows must outlive a deleted user.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->morphs('auditable');
            // Plain varchar, not ENUM — same reasoning as users.role.
            $table->string('action');
            $table->json('changes')->nullable();
            $table->string('ip_address')->nullable();
            // Append-only: created_at only, no updated_at column.
            $table->timestamp('created_at')->useCurrent();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
