<?php

namespace Modules\Administration\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Becoming somebody else needs a subject and a reason (ADR-0056).
 *
 * The **reason is required**, which the ADR does not demand. It is the first
 * question an auditor asks a support log, and the cheapest moment to capture
 * it is the one where somebody is already typing. A nullable field here would
 * be null on every row within a month.
 */
class BeginImpersonationRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Answered before the rules run, so an agent without the grant is
        // refused without having to name a subject — the refusal must not
        // depend on, or reveal, who they were about to become.
        return Gate::allows('act-as-another-user');
    }

    /**
     * Which of the two principals the subject is (ADR-0066 §1).
     *
     * `user` when absent, so every caller written against ADR-0056 keeps
     * working unchanged — the console's fleet and client dialogs send a bare
     * `subject_id` and mean a staff account by it.
     */
    public function subjectIsWalkIn(): bool
    {
        return $this->input('subject_type') === 'customer';
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            // Two words rather than a class name. A morph alias in a request
            // body is a caller naming a PHP class, and the first person to
            // send `App\Models\User` with a different namespace gets a 500 —
            // or, worse, resolves something nobody meant to expose.
            'subject_type' => ['sometimes', 'string', 'in:user,customer'],
            // The table depends on the kind, which is why this is a closure
            // rather than two `exists` rules: `exists:users,id` on a walk-in's
            // id would pass whenever the two tables happened to share a
            // number, and act as the wrong person entirely.
            'subject_id' => [
                'required',
                'integer',
                $this->subjectIsWalkIn() ? 'exists:customers,id' : 'exists:users,id',
            ],
            // Long enough for a ticket reference and a sentence; short enough
            // that it stays a reason rather than becoming a report.
            'reason' => ['required', 'string', 'min:8', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Say why you are acting as this person. It is recorded against your name.',
            'reason.min' => 'Give a real reason — a ticket number and what you are trying to see.',
        ];
    }
}
