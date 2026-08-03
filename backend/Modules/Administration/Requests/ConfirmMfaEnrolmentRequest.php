<?php

namespace Modules\Administration\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Proves the authenticator app actually holds the secret before enrolment
 * is treated as done (ADR-0008).
 *
 * Without this step a user could store a secret they never successfully
 * scanned and be locked out by their own enrolment at the next login — with
 * no administrator able to reset it, which is the hazard ADR-0008's Context
 * describes.
 */
class ConfirmMfaEnrolmentRequest extends FormRequest
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
        // Only a TOTP code is accepted here, unlike verification: recovery
        // codes do not exist until this request succeeds.
        return ['code' => ['required', 'string', 'max:16']];
    }
}
