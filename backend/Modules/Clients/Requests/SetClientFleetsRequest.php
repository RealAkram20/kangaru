<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SetClientFleetsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The whole set, and at least one of them.
     *
     * **`min:1` is the load-bearing rule.** ADR-0062 §3: a client with no
     * fleet has nobody to run its trips, and it fails the way this codebase
     * least wants — nothing errors, the client simply books and is never
     * dispatched. The onboarding form refuses to create such a client; without
     * this rule the edit form could produce one by unticking the last box, and
     * the same invariant would hold on the way in and not on the way back.
     *
     * `distinct` because a repeated id is a caller's bug, not a second
     * contract, and the table's unique pair would refuse it as an
     * integrity-constraint 500 rather than a message anybody can act on.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'operator_ids' => ['required', 'array', 'min:1'],
            'operator_ids.*' => ['integer', 'distinct', 'exists:operators,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'operator_ids.min' => 'A client needs at least one fleet to serve it.',
            'operator_ids.required' => 'A client needs at least one fleet to serve it.',
        ];
    }
}
