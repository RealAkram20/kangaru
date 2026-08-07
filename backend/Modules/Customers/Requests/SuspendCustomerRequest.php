<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Suspending a customer account (ADR-0018 §3).
 */
class SuspendCustomerRequest extends FormRequest
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
            // Required, unlike the note on a declined leave request. The
            // difference is who reads it: this is the sentence a support
            // agent says out loud to a member of the public asking why they
            // cannot sign in, and "no reason recorded" is not an answer a
            // platform should have to give. Ten characters is enough to
            // stop "n/a" without inviting an essay.
            'reason' => ['required', 'string', 'min:10', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Say why this account is being suspended — the customer will ask.',
            'reason.min' => 'Give a reason somebody could read back to the customer.',
        ];
    }
}
