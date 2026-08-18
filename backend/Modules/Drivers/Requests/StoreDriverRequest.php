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
            // The vehicle this driver drives. Nullable: a corporate driver
            // takes whatever the depot hands them, and presence carries the
            // per-shift answer for them. For a boda rider it is the driver's
            // own machine and effectively permanent.
            //
            // The fleet is platform-owned and unscoped by tenant (ADR-0005),
            // so `exists` needs no tenant clause — adding one would be the
            // mistake, not the safeguard.
            'vehicle_id' => ['nullable', 'integer', Rule::exists('vehicles', 'id')->whereNull('deleted_at')],
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
