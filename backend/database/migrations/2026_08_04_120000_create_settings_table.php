<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0014: platform-wide, owner-editable configuration.
 *
 * Grouped key-value with JSON values. The catalogue of legal keys lives
 * in SettingsService::CATALOGUE, not here — a row this table holds that
 * the catalogue does not name is dead weight, and the service refuses to
 * write one. `is_secret` is stored (not only known to the catalogue) so
 * a future reader of the raw table knows which values are ciphertext.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('group', 40);
            $table->string('key', 60);
            $table->json('value')->nullable();
            $table->boolean('is_secret')->default(false);
            $table->timestamps();

            $table->unique(['group', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settings');
    }
};
