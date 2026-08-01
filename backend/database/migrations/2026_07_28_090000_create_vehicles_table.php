<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();
            // Many vehicles per tenant — unlike companies.tenant_id, not unique.
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('registration_number');
            $table->string('make');
            $table->string('model');
            $table->unsignedSmallInteger('year');
            // Kept as a validated string, not a DB enum or reference table —
            // Fleet's vehicle-categories table is deferred to a later pass.
            $table->string('category');
            $table->unsignedTinyInteger('seating_capacity');
            $table->string('color')->nullable();
            $table->string('vin')->nullable();
            $table->string('status')->default('active');
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'registration_number']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};
