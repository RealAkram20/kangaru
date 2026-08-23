<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0045 §8: the team who ride the route.
 *
 * The owner's ruling, and the distinction worth keeping straight: this
 * answers **"who is on this run"**, not "who may book it". It is not a
 * permission and nothing authorises off it — `ClientRoutePolicy` gates on
 * `routes.view` / `routes.manage` and `ClientCapability::MANAGES_ROUTES`
 * exactly as it would if this table did not exist.
 *
 * What it is for: the bank's servicing team see the circuit on their own
 * dashboard, and a booking raised from the route can prefill its passengers
 * instead of somebody retyping three names every Monday.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_route_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('client_route_id')->constrained()->cascadeOnDelete();

            // cascadeOnDelete, unlike `trips.driver_id`: membership is a
            // roster entry, not audit-relevant history. A trip that ran
            // records who actually travelled on the trip itself; nobody
            // needs to know a departed employee was once pencilled in.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->timestamps();

            $table->unique(['client_route_id', 'user_id']);
            $table->index(['tenant_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_route_members');
    }
};
