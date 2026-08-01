<?php

namespace Modules\Vehicles\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
                Rule::unique('vehicles')->where(
                    fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())
                ),
            ],
            'make' => ['required', 'string', 'max:100'],
            'model' => ['required', 'string', 'max:100'],
            'year' => ['required', 'integer', 'min:1980', 'max:'.(date('Y') + 1)],
            'category' => ['required', 'string', 'in:sedan,suv,van,minibus,bus,pickup,truck'],
            'seating_capacity' => ['required', 'integer', 'min:1', 'max:100'],
            'color' => ['nullable', 'string', 'max:50'],
            'vin' => ['nullable', 'string', 'max:50'],
            'status' => ['nullable', 'string', 'in:active,maintenance,inactive'],
        ];
    }
}
