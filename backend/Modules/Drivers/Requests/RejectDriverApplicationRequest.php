<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Ending an application (ADR-0027 §4).
 *
 * The reason is required, and it is for the office rather than the
 * applicant — nothing sends it to them, because ADR-0027 §6 gives an
 * applicant no way to read their own record. It exists so that a second
 * reviewer, or the same one three months later, can tell a lapsed licence
 * apart from a decision somebody would want revisited.
 */
class RejectDriverApplicationRequest extends FormRequest
{
    public function authorize(): bool
    {
        // DriverApplicationPolicy::decide, applied in the controller.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // A minimum, because "no" on its own is not a record. Short
            // enough that it is one sentence, long enough for the sentence
            // to say something.
            'reason' => ['required', 'string', 'min:5', 'max:500'],
        ];
    }
}
