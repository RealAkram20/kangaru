<?php

namespace Modules\Drivers\Requests;

use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Modules\Vehicles\Rules\ActiveVehicleCategory;

/**
 * The vehicle half of the driver form (ADR-0048 §8).
 *
 * A trait shared by `StoreDriverRequest` and `UpdateDriverRequest` rather than
 * a block copied into both. `AGENTS.md`: if something appears twice it becomes
 * shared — and this is the kind of duplication that bites, because a
 * validation rule that drifts between create and edit is a field the office
 * can set on one screen and not the other.
 *
 * ## The rules are the fleet's own
 *
 * Every rule below is `StoreVehicleRequest`'s, deliberately verbatim in
 * meaning: the same plate uniqueness, the same year window, the same category
 * rule read from the `vehicle_categories` table (ADR-0050). **A vehicle created from the driver
 * form is an ordinary fleet vehicle** (ADR-0048 §8) — it appears on
 * `VehiclesPage`, it dispatches, and nothing marks it as having arrived by a
 * side door. If it were validated more loosely than one typed on the fleet
 * screen, the side door would be exactly what it was.
 *
 * The one thing not shared is the `Rule::unique` on the plate, which cannot be
 * because the two requests need different ignore behaviour. It is stated once,
 * here, and the driver form has no edit case for it — see `inlineVehicleRules`.
 */
trait ValidatesInlineVehicle
{
    /**
     * @return array<string, mixed>
     */
    protected function inlineVehicleRules(): array
    {
        return [
            /**
             * Present only when the clerk is registering a vehicle the fleet
             * has never seen. `nullable` rather than `sometimes` so that a
             * form which submits `vehicle: null` — which is what an unticked
             * checkbox serialises to — is accepted rather than picked apart.
             */
            'vehicle' => ['nullable', 'array'],
            'vehicle.registration_number' => [
                'required_with:vehicle',
                'string',
                'max:50',
                // Global, not per tenant, for the reason StoreVehicleRequest
                // gives: the fleet is the platform's (ADR-0005) and a number
                // plate is unique under any reading. No `ignore()` — this
                // path only ever creates, never edits, so there is no own-row
                // to exempt and an `ignore()` here would be a way to take a
                // plate off another vehicle.
                Rule::unique('vehicles', 'registration_number'),
            ],
            'vehicle.make' => ['required_with:vehicle', 'string', 'max:100'],
            'vehicle.model' => ['required_with:vehicle', 'string', 'max:100'],
            'vehicle.year' => ['required_with:vehicle', 'integer', 'min:1980', 'max:'.(date('Y') + 1)],
            // ADR-0050: the categories table, not the constant. No
            // `alsoAllow` — this path only ever creates, so there is no
            // stored category to grandfather, and a retired one must not be
            // choosable from a form the office is filling in now.
            'vehicle.category' => ['required_with:vehicle', 'string', new ActiveVehicleCategory],
            'vehicle.seating_capacity' => ['required_with:vehicle', 'integer', 'min:1', 'max:100'],
            'vehicle.color' => ['nullable', 'string', 'max:50'],
            'vehicle.vin' => ['nullable', 'string', 'max:50'],
        /**
         * Deliberately absent: `vehicle.status`.
         *
         * A vehicle registered alongside its driver is `active`, which is
         * the column default. Offering the field would let a clerk create
         * a vehicle in `maintenance` from a screen that has no way to say
         * what is being maintained — and a driver linked to a vehicle
         * that cannot work is a state nobody set out to create.
         */
        ];
    }

    /**
     * The two ways of naming a vehicle are mutually exclusive.
     *
     * `vehicle_id` says "one the fleet already has"; `vehicle` says "one it
     * does not". A request carrying both is **refused rather than resolved**,
     * for the reason ADR-0016 §4 refuses a request carrying both shapes of
     * account: resolving it silently means guessing, and the guess that
     * creates a duplicate vehicle for a driver who already had one is a fleet
     * record nobody asked for and nobody will notice.
     */
    protected function validateInlineVehicle(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $inline = $this->input('vehicle');
            $hasInline = is_array($inline) && $inline !== [];

            if ($hasInline && $this->filled('vehicle_id')) {
                $validator->errors()->add(
                    'vehicle',
                    'Choose a vehicle from the fleet or register a new one, not both.',
                );
            }

            /**
             * Registering a vehicle for a driver who does not own one is not
             * an error the platform can interpret.
             *
             * It is refused rather than silently flipping `owns_vehicle` to
             * true: the flag is the fact the office is asserting (ADR-0048
             * §7), and a form that quietly rewrites an assertion is worse
             * than one that asks.
             */
            if ($hasInline && $this->has('owns_vehicle') && ! $this->boolean('owns_vehicle')) {
                $validator->errors()->add(
                    'owns_vehicle',
                    'Tick "owns their vehicle" to register a vehicle here, or pick one from the fleet instead.',
                );
            }
        });
    }

    /**
     * @return array<string, string>
     */
    protected function inlineVehicleMessages(): array
    {
        return [
            'vehicle.registration_number.unique' => 'That number plate is already on a vehicle in the fleet.',
            'vehicle.registration_number.required_with' => 'The number plate is needed to register a vehicle.',
            'vehicle.make.required_with' => 'Say what make the vehicle is.',
            'vehicle.model.required_with' => 'Say what model the vehicle is.',
            'vehicle.year.required_with' => 'Say what year the vehicle is.',
            'vehicle.category.required_with' => 'Choose what kind of vehicle it is.',
            'vehicle.seating_capacity.required_with' => 'Say how many people it seats.',
        ];
    }
}
