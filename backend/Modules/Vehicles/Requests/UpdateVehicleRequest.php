<?php

namespace Modules\Vehicles\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Vehicles\Models\Vehicle;

class UpdateVehicleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * All fields optional — PATCH semantics.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // Narrowed explicitly: `route()` is typed `object|string`, and a
        // bound model is what actually arrives. Reaching straight for ->id
        // is what static analysis objects to, rightly — a route parameter
        // that had not been substituted would be a string.
        $vehicle = $this->route('vehicle');

        return [
            'registration_number' => [
                'sometimes',
                'string',
                'max:50',
                // Global since ADR-0005 — the fleet is the platform's and a
                // plate is unique in Uganda — ignoring this vehicle's own
                // row so a no-op save is not a conflict with itself.
                Rule::unique('vehicles')->ignore($vehicle instanceof Vehicle ? $vehicle->id : null),
            ],
            'make' => ['sometimes', 'string', 'max:100'],
            'model' => ['sometimes', 'string', 'max:100'],
            'year' => ['sometimes', 'integer', 'min:1980', 'max:'.(date('Y') + 1)],
            'category' => ['sometimes', 'string', Rule::in(Vehicle::CATEGORIES)],
            'seating_capacity' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'color' => ['sometimes', 'nullable', 'string', 'max:50'],
            'vin' => ['sometimes', 'nullable', 'string', 'max:50'],
            'status' => ['sometimes', 'string', 'in:active,maintenance,inactive'],
        ];
    }
}
