<?php

namespace Modules\Drivers\Requests;

use App\Support\Tenancy\TenantContext;
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
                Rule::unique('drivers')->where(
                    fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())
                ),
            ],
            'license_expiry' => ['required', 'date'],
            'status' => ['nullable', 'string', 'in:active,suspended,inactive'],
        ];
    }
}
