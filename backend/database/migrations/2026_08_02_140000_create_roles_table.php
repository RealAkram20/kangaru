<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Roles become data (ADR-0004).
     *
     * Platform-wide, with no `tenant_id`: custom roles are curated by the
     * Super Admin and every tenant picks from the same catalogue. A tenant
     * that could compose its own permission sets would be a tenant that
     * could grant itself abilities, which is the escalation surface this
     * design exists to keep small.
     */
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();

            // The stable machine name. Matches App\Enums\UserRole's values
            // for the ten system roles, which is what lets `users.role`
            // keep working untouched.
            $table->string('slug')->unique();
            $table->string('name');
            $table->string('description')->nullable();

            // System roles are the ten from PROJECT.md. They may have their
            // permissions edited — that is the point of the feature — but
            // they cannot be deleted or renamed, because seeders, tests and
            // every existing `users.role` value refer to them by slug.
            $table->boolean('is_system')->default(false);

            // JSON rather than a permission_role pivot (ADR-0004): the
            // catalogue lives in App\Enums\Permission, so a pivot would
            // enforce referential integrity against a table that is itself
            // only a copy of code. One row per role also keeps the audit
            // diff legible, which is the thing a bank actually reads.
            $table->json('permissions');

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('roles');
    }
};
