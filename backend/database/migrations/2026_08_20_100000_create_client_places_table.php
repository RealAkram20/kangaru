<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0045 §1: the client's own register of pinned locations.
 *
 * The ATM estate, the branches, the head office — the places a corporate
 * client's routes are built out of, and the same object the corporate panel
 * plan's E3 calls "default pickup addresses". Built once, serving both.
 *
 * ## Coordinates are required here, and that is deliberate
 *
 * `PlaceField` exists because free text must always stand: a dispatcher on
 * the phone types what the caller says, and the booking is created with no
 * coordinates rather than putting a geocoder between an operator and their
 * work.
 *
 * **This is the other context.** A place is a *pin* — that is what the word
 * means on this table. It is created by an officer at a desk, on a map, and
 * its whole purpose is to be a vertex a polyline passes through. A route
 * stop with no coordinates is not a degraded stop; it is a stop that cannot
 * be drawn, cannot be measured and cannot be navigated to. So the column is
 * NOT NULL and the refusal happens at the request layer with a sentence
 * saying why, rather than a null propagating into a map that silently omits
 * one ATM from the circuit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_places', function (Blueprint $table) {
            $table->id();
            // ADR-0001. A client's ATM locations are exactly the kind of
            // data the cross-tenant test suite exists for.
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            // What the geocoder returned, or what the officer corrected it
            // to. Nullable: a pin dropped on an unnamed service road off
            // Jinja Road has coordinates and no address, and refusing it
            // would be refusing the exact case the map is for.
            $table->string('address')->nullable();

            // Same 10,7 as `trip_locations`, `live_positions` and
            // `bookings.origin_*`, so the four compare without a cast.
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);

            // How close a driver must be for this to count as an arrival.
            // Nullable means "use the platform default" rather than zero,
            // which would mean no arrival is ever close enough. Read by a
            // later step; nothing consults it yet.
            $table->unsignedSmallInteger('arrival_radius_m')->nullable();

            // Standing instructions for whoever services this site — "use
            // the rear entrance", "guard has the key". Travels to the
            // driver on a stop, not to an invoice.
            $table->text('notes')->nullable();

            // Retiring a place must not rewrite the routes that used it, so
            // this is a flag rather than a delete.
            $table->boolean('is_active')->default(true);

            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // One live "Nakawa ATM" per client, and the invariant is the
            // database's rather than a service's. `deleted_at` rides in the
            // key because MySQL treats NULLs as distinct: any number of
            // soft-deleted rows may share a name, exactly one live one may
            // hold it, and retiring a place frees its name for reuse.
            $table->unique(['tenant_id', 'name', 'deleted_at']);
            $table->index(['tenant_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_places');
    }
};
