<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user capabilities a corporate client's administrator switches on for
 * their own people (App\Enums\ClientCapability), and the one flag that is
 * not a permission: whether a booking this person creates needs approving.
 *
 * Roles are platform-wide (ADR-0004), so a client cannot own one; a
 * client can own a person's switches. Null capabilities and false
 * approval-free are the existing behaviour for every account.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('capabilities')->nullable()->after('role');
            $table->boolean('books_without_approval')->default(false)->after('capabilities');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['capabilities', 'books_without_approval']);
        });
    }
};
