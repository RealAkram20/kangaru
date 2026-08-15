<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The office turning a document down (ADR-0033 §3).
 *
 * Authorisation is the policy's, applied in the controller.
 */
class RejectDriverDocumentRequest extends FormRequest
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
             * **Required, and that is the rule this class exists for.**
             *
             * A rejection with no reason is how a driver stops using a
             * feature: they are told no, cannot tell whether the photograph
             * was blurred or the document was wrong, and re-upload the same
             * file. ADR-0032 §3 reached the identical conclusion about a
             * declined settlement, and this is the same sentence in a
             * different module.
             */
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Say why, so the driver can send the right thing.',
        ];
    }
}
