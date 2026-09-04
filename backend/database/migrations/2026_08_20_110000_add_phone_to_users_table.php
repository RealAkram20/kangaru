<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A work number on the staff account.
 *
 * The client's own booking flow is the reason: a booking names a passenger
 * and a number a driver can ring, and until now both were typed by hand
 * every time — so the same employee arrived as "J. Mukasa" on Monday and
 * "Joseph Mukasa" on Tuesday, with whichever number the person raising it
 * remembered. Collected once, on the account, and read from there.
 *
 * Nullable: every account that already exists has no number, and a column
 * that forced one would have to invent them. `StoreUserRequest` requires it
 * for accounts created from here on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone', 32)->nullable()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('phone');
        });
    }
};
