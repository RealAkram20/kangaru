<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0045 §1: the route a client builds and owns — the *plan* half.
 *
 * "Kampala Central ATM Run", seven stops, run every Monday by three people.
 * Editable for as long as it exists, which is precisely why a trip built
 * from it **copies** its stops rather than pointing at them: editing this
 * row in October must not change what September's invoice was for. The
 * evidence half is `trip_stops`, and the two never speak again after a
 * booking is raised.
 *
 * ## No schedule column, on purpose
 *
 * ADR-0045 §8: a route is a template and a booking is raised from it by
 * hand. Recurring generation stays where the corporate panel plan already
 * put it (B3). A nullable `repeats_weekly_until` sitting here unread would
 * be a promise the platform does not keep, and the next reader would build
 * against it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_routes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            // The client's own code for the run — "CB/ATM/CENTRAL". Theirs,
            // not ours: `Identifier` renders it verbatim and nothing parses
            // it. Nullable because most clients will not have one.
            $table->string('reference', 40)->nullable();
            $table->text('notes')->nullable();

            // Retired rather than deleted, for the reason `client_places`
            // gives: the trips it produced are still on the books.
            $table->boolean('is_active')->default(true);

            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // See `client_places` for why `deleted_at` is in the key.
            $table->unique(['tenant_id', 'name', 'deleted_at']);
            $table->index(['tenant_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_routes');
    }
};
