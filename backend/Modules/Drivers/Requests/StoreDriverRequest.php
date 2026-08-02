<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDriverRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:50'],
            'email' => ['nullable', 'email'],
            'license_number' => [
                'required',
                'string',
                'max:100',
                // Global, not per tenant — see StoreVehicleRequest.
                Rule::unique('drivers'),
            ],
            'license_expiry' => ['required', 'date'],
            'status' => ['nullable', 'string', 'in:active,suspended,inactive'],
        ];
    }
}
