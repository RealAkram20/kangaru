<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which account an application minted, if it minted one.
 *
 * ADR-0027 §1 kept applicants out of `users` so that no policy would have to
 * learn a third state. The amendment does not bring that third state back —
 * the account is `active` and inert, because every driver-facing controller
 * resolves the actor through `drivers.user_id` and answers "not a driver"
 * when there is none. What it does need is a way to tell *this* application's
 * account apart from a stranger's with the same address, and that is this
 * column.
 *
 * **Nullable, and the null case is not an edge.** ADR-0027 §5 requires the
 * public endpoint to answer identically whether or not the email is already
 * known, so an application whose email is taken is stored with no account at
 * all and refused at approval in front of a human. Every application written
 * before this migration is in the same state. Both are ordinary.
 *
 * `nullOnDelete`: deleting a user should not delete the record that somebody
 * applied. The application is evidence of an event; the account is a
 * consequence of it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('driver_applications', function (Blueprint $table) {
            $table->foreignId('user_id')
                ->nullable()
                ->after('email')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('driver_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_id');
        });
    }
};
