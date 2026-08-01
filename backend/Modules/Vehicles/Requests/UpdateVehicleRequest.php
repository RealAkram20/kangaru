<?php

namespace Modules\Vehicles\Requests;

use App\Support\Tenancy\TenantContext;
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
        return [
            'registration_number' => [
                'sometimes',
                'string',
                'max:50',
                Rule::unique('vehicles')
                    ->ignore($this->route('vehicle'))
                    ->where(fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())),
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
