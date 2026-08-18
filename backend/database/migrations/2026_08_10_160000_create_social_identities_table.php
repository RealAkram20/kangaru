<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which provider identity signs in as which account (ADR-0028 §3).
     *
     * The unique key is (provider, provider_id) — Google's `sub`, Facebook's
     * app-scoped id — never the email: providers let people change emails,
     * and an identity that drifted addresses must keep opening the same
     * account rather than a second one. `email_at_link` is kept as the
     * forensic record of what the provider asserted on the day the link was
     * made.
     */
    public function up(): void
    {
        Schema::create('social_identities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 20);
            $table->string('provider_id', 128);
            $table->string('email_at_link', 190);
            $table->timestamps();

            $table->unique(['provider', 'provider_id']);
            // One link per provider per account: a second Google identity on
            // the same login is not a convenience, it is two people sharing
            // a driver account — the thing ADR-0016 §3 exists to prevent.
            $table->unique(['provider', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('social_identities');
    }
};
