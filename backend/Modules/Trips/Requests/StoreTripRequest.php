<?php

namespace Modules\Trips\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTripRequest extends FormRequest
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
        $tenantId = app(TenantContext::class)->get();

        return [
            'vehicle_id' => [
                'required',
                'integer',
                Rule::exists('vehicles', 'id')->where(
                    fn ($query) => $query->where('tenant_id', $tenantId)
                        ->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
            'driver_id' => [
                'required',
                'integer',
                Rule::exists('drivers', 'id')->where(
                    fn ($query) => $query->where('tenant_id', $tenantId)
                        ->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
            'origin' => ['required', 'string', 'max:255'],
            'destination' => ['required', 'string', 'max:255'],
        ];
    }
}
