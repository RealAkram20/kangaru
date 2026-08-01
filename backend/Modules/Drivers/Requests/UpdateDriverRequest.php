<?php

namespace Modules\Drivers\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'string', 'max:50'],
            'email' => ['sometimes', 'nullable', 'email'],
            'license_number' => [
                'sometimes',
                'string',
                'max:100',
                Rule::unique('drivers')
                    ->ignore($this->route('driver'))
                    ->where(fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())),
            ],
            'license_expiry' => ['sometimes', 'date'],
            'status' => ['sometimes', 'string', 'in:active,suspended,inactive'],
        ];
    }
}
