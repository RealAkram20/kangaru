<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where to push a notification (ADR-0025 §4).
 *
 * One row per install, not per user: a driver with two handsets has two, and
 * both should ring. The token identifies the app installation, which is
 * exactly the granularity a push service works at.
 *
 * **No tenant column**, like every other row that belongs to the platform
 * rather than to a client (ADR-0005) — a driver has no tenant, and neither
 * does their phone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_tokens', function (Blueprint $table) {
            $table->id();

            // cascadeOnDelete, unlike most foreign keys in this schema. A
            // device token is not evidence and has no value once its account
            // is gone — it is a routing address, and keeping one that points
            // at a deleted user's handset is how somebody else's job offer
            // lands on a phone that has changed hands.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Which push service the token belongs to. `expo` today; ADR-0025
            // §2 keeps FCM and APNs available as a second implementation
            // behind the same channel, and this is what lets both live in one
            // table when that day comes.
            $table->string('provider', 20)->default('expo');

            // Globally unique, not unique per user, and that is the point: a
            // handset that was signed in as one driver and is now signed in
            // as another must not be reachable as both. The newer
            // registration takes the row.
            $table->string('token', 255)->unique();

            $table->string('platform', 20)->nullable();
            $table->string('app_version', 40)->nullable();

            // Refreshed on every registration. A driver on duty with no
            // device row, or a row not seen in a week, is somebody the fleet
            // office should ask about — ADR-0025's Consequences name this as
            // how a silent per-driver delivery failure becomes noticeable.
            $table->dateTime('last_seen_at')->nullable();

            $table->timestamps();

            // The send path: every token for these users.
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_tokens');
    }
};
