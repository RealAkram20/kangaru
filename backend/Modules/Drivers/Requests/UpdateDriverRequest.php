<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Drivers\Models\Driver;

class UpdateDriverRequest extends FormRequest
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
        // See UpdateVehicleRequest: `route()` is typed `object|string`, so
        // the bound model is narrowed rather than assumed.
        $driver = $this->route('driver');

        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'string', 'max:50'],
            'email' => ['sometimes', 'nullable', 'email'],
            'license_number' => [
                'sometimes',
                'string',
                'max:100',
                // Global since ADR-0005, ignoring this driver's own row.
                Rule::unique('drivers')->ignore($driver instanceof Driver ? $driver->id : null),
            ],
            'license_expiry' => ['sometimes', 'date'],
            'status' => ['sometimes', 'string', 'in:active,suspended,inactive'],
        ];
    }
}
