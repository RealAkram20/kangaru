<?php

namespace Modules\Vehicles\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Vehicles\Models\Vehicle;

class StoreVehicleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'registration_number' => [
                'required',
                'string',
                'max:50',
                // Global, not per tenant: the fleet is the platform's
                // (ADR-0005), and a number plate is unique in Uganda under
                // any reading. The old per-tenant rule let two clients each
                // register UAA 111A.
                Rule::unique('vehicles'),
            ],
            'make' => ['required', 'string', 'max:100'],
            'model' => ['required', 'string', 'max:100'],
            'year' => ['required', 'integer', 'min:1980', 'max:'.(date('Y') + 1)],
            'category' => ['required', 'string', Rule::in(Vehicle::CATEGORIES)],
            'seating_capacity' => ['required', 'integer', 'min:1', 'max:100'],
            'color' => ['nullable', 'string', 'max:50'],
            'vin' => ['nullable', 'string', 'max:50'],
            'status' => ['nullable', 'string', 'in:active,maintenance,inactive'],
        ];
    }
}
