<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0050. Closes the deferral written on `vehicles.category` in
 * `create_vehicles_table`: *"Kept as a validated string, not a DB enum or
 * reference table — Fleet's vehicle-categories table is deferred to a later
 * pass."*
 *
 * **`vehicles.category` stays a string and is not turned into a foreign
 * key.** So do `rate_card_rates.vehicle_category` and
 * `invoice_lines.vehicle_category`. ADR-0050 §1 and its Alternatives explain
 * why at length; the short version is that an invoice line must reproduce
 * from stored data without joining a table somebody can rename, or renaming
 * a category would retroactively edit a document already sent to a bank.
 *
 * This table is therefore a *vocabulary*, not a parent. It says which keys
 * may be chosen next and what each is called; it does not own the ones
 * already written down.
 *
 * Not `tenant_id`-scoped, matching `Vehicle` (ADR-0005): one fleet, one
 * vocabulary.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicle_categories', function (Blueprint $table) {
            $table->id();
            // The string already stored on vehicles, rate card rates and
            // invoice lines. Unique and, per ADR-0050 §2, never editable —
            // UpdateVehicleCategoryRequest does not accept the field at all.
            $table->string('key', 40)->unique();
            $table->string('name', 80);
            $table->string('description', 255)->nullable();
            // Whether a new vehicle or a new rate card version may choose it.
            // Retiring is the only "delete" available once anything uses the
            // key; it changes no price and voids no record (ADR-0050 §3).
            $table->boolean('active')->default(true);
            // Display order. The const this replaces was already ordered
            // smallest-first, because that is how a chooser reads.
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();

            // Every list is "the ones you may pick, in reading order".
            $table->index(['active', 'position']);
        });

        $this->seedFromTheConstant();
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_categories');
    }

    /**
     * The nine keys that existed as a PHP constant, landed by the migration
     * rather than by a seeder.
     *
     * A seeder would make this a deploy step, and the failure mode of
     * forgetting it is a production fleet in which **no vehicle can be
     * created at all** — every category the form offers fails validation
     * against an empty table. That is not a step worth leaving to a runbook.
     *
     * Reading `Vehicle::CATEGORIES` rather than repeating the nine strings is
     * deliberate: this is the last moment the constant is the source of
     * truth, and a hand-typed copy here would be a tenth mirror of exactly
     * the list this migration exists to stop mirroring.
     *
     * The names are the ones the driver app already says out loud
     * (`VEHICLE_CATEGORY_LABELS` in `mobile/src/duty/offerPresentation.ts`),
     * so a category reads the same in both apps from the first minute. Note
     * `SUV` — title-casing the key would have produced "Suv", which that
     * file's own comment calls out as the kind of small wrongness that makes
     * a driver trust nothing else on the screen.
     */
    private function seedFromTheConstant(): void
    {
        $names = [
            'boda' => 'Boda',
            'tricycle' => 'Tricycle',
            'sedan' => 'Sedan',
            'suv' => 'SUV',
            'van' => 'Van',
            'minibus' => 'Minibus',
            'bus' => 'Bus',
            'pickup' => 'Pickup',
            'truck' => 'Truck',
        ];

        $now = now();
        $rows = [];

        foreach (Vehicle::CATEGORIES as $position => $key) {
            $rows[] = [
                'key' => $key,
                // A key with no name here would be a category rendering as
                // its own slug. Falling back to the key makes that visible
                // and harmless rather than null.
                'name' => $names[$key] ?? $key,
                'description' => null,
                'active' => true,
                'position' => $position,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        DB::table('vehicle_categories')->insert($rows);
    }
};
