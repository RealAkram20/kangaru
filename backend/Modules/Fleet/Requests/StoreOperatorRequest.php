<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Onboarding a fleet company (ADR-0055, ADR-0059 §5).
 */
class StoreOperatorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The owner's name and email are **required**, not optional.
     *
     * ADR-0059 §5: you act as a person, not an organisation, so a fleet with
     * no account is unreachable to support forever. Making these optional
     * would make the failure mode the default path.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            // Optional: generated from the name when absent. Unique by the
            // column as well, because two simultaneous onboardings of one
            // name is a race no `SELECT` here can win.
            'slug' => ['nullable', 'string', 'max:255', 'alpha_dash', Rule::unique('operators', 'slug')],
            'owner_name' => ['required', 'string', 'max:255'],
            'owner_email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'owner_name.required' => 'A fleet needs somebody to sign in as, or nobody can reach it — including support.',
            'owner_email.required' => 'A fleet needs somebody to sign in as, or nobody can reach it — including support.',
        ];
    }
}
