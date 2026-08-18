<?php

namespace Modules\Support\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The office writing a reply (ADR-0044 §2).
 *
 * Authorisation is the policy's, applied in the controller against the route's
 * bound model — a form request cannot see it before binding and would be
 * checking a permission in the wrong place.
 */
class AnswerSupportRequest extends FormRequest
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
            /**
             * **Required, with a floor.** There is no "close without an
             * answer" on this feature (ADR-0044 §2), and an empty or one-word
             * reply is that close wearing a costume: it moves the row out of
             * the queue and tells the driver nothing.
             *
             * The floor is deliberately low. "Sorted, thanks" is a legitimate
             * answer to some reports and the office should not be made to pad
             * it.
             */
            'answer' => ['required', 'string', 'min:5', 'max:4000'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'answer.required' => 'Write what the driver should be told.',
            'answer.min' => 'Write a little more — this is what the driver reads.',
        ];
    }
}
