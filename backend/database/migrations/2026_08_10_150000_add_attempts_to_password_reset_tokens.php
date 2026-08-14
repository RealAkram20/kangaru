<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ADR-0028 §2: five wrong guesses burn a reset code.
     *
     * The scaffold's table stores one token per email; this counts the
     * failures against it. Without the counter, a six-digit code inside a
     * fifteen-minute window is a million possibilities against a 5/min/IP
     * throttle — safe from one address, not from a botnet's worth. With it,
     * the code dies long before the search space matters.
     */
    public function up(): void
    {
        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->unsignedTinyInteger('attempts')->default(0)->after('token');
        });
    }

    public function down(): void
    {
        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->dropColumn('attempts');
        });
    }
};
