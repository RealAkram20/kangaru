<?php

namespace Modules\Administration\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Proves the caller still holds the factor they are removing (ADR-0010
 * decision 2).
 *
 * A code rather than a password. The password is what the session already
 * proved, so asking for it again would gate removal of the second factor on
 * the first — which is the whole thing the second factor exists to survive.
 * Requiring a *code* means an attacker with a stolen token cannot strip the
 * protection without already holding it.
 *
 * `max:16` rather than a six-digit rule, because a recovery code is accepted
 * here too: somebody turning MFA off after losing their phone is exactly the
 * person who cannot produce a TOTP code, and refusing them would leave the
 * account in the unrecoverable state ADR-0010 exists to prevent.
 */
class DisableMfaRequest extends FormRequest
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
        return ['code' => ['required', 'string', 'max:16']];
    }
}
