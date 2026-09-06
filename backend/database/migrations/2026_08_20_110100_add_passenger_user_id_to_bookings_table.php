<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which colleague is travelling, when a client raises the booking.
 *
 * `passenger_name` and `passenger_phone` stay, and stay authoritative for
 * the trip: they are the snapshot a driver is dispatched against, and
 * rewriting last month's evidence because somebody changed their phone
 * number is the same mistake `ClientRoute` copies its stops to avoid.
 *
 * This column is the *link*, not the source — it is what lets a client's
 * queue say "raised for Joseph Mukasa" and mean the account, so a booking
 * can be found by employee rather than by however the name was spelled.
 *
 * Nullable, because not every booking has one: Shanitah's own dispatchers
 * raise bookings for walk-ins and callers who have no account anywhere.
 * `nullOnDelete` for the reason `client_route_members` cascades — the
 * booking is history and outlives the roster entry.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->foreignId('passenger_user_id')
                ->nullable()
                ->after('requested_by_user_id')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('passenger_user_id');
        });
    }
};
