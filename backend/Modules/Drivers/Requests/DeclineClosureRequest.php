<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The office declining a closure, with a reason (ADR-0043 §4).
 *
 * **The reason is required, and that asymmetry with the driver's optional one
 * is the design.** A driver leaving owes nobody an explanation; an office
 * refusing to let them leave does. "Settle your balance first" is an answer a
 * driver can act on, where a bare refusal is how somebody stops using a feature
 * — the same call ADR-0032 made for declining a settlement.
 *
 * Authorisation is the policy's, checked in the controller.
 */
class DeclineClosureRequest extends FormRequest
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
            'reason' => ['required', 'string', 'max:500'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Give the driver a reason. It is emailed to them.',
        ];
    }
}
