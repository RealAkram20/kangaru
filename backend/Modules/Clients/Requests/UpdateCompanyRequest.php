<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCompanyRequest extends FormRequest
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
            'legal_name' => ['sometimes', 'string', 'max:255'],
            'trading_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            /*
             * Unique, ignoring this client (ADR-0060 §1).
             *
             * The column has carried a unique index since it became the
             * platform identity, and this rule did not — so editing a client's
             * registration number onto one already taken produced a raw
             * integrity-constraint 500 rather than a field error under the
             * field. The database was right and the message was unusable.
             *
             * `withoutTrashed()` matches `OnboardClientRequest`: a soft-deleted
             * client must not reserve a number for ever.
             */
            'registration_number' => [
                'sometimes', 'nullable', 'string', 'max:255',
                Rule::unique('companies', 'registration_number')
                    ->ignore($this->route('company'))
                    ->withoutTrashed(),
            ],
            'industry' => ['sometimes', 'nullable', 'string', 'max:255'],
            'billing_email' => ['sometimes', 'email'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'address_line1' => ['sometimes', 'nullable', 'string', 'max:255'],
            'address_line2' => ['sometimes', 'nullable', 'string', 'max:255'],
            'city' => ['sometimes', 'string', 'max:255'],
            'country' => ['sometimes', 'string', 'max:255'],
            'credit_limit_minor' => ['sometimes', 'integer', 'min:0'],
            'status' => ['sometimes', 'string', 'in:active,suspended'],
        ];
    }
}
