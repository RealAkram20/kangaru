<?php

namespace Modules\Administration\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The second step of a two-step login (ADR-0008 decision 2).
 *
 * Unauthenticated by design: the caller has proved a password and holds a
 * challenge, which is precisely the state in which no token exists yet.
 */
class VerifyMfaRequest extends FormRequest
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
            'challenge_id' => ['required', 'string'],
            // Deliberately loose on shape. A six-digit TOTP code and an
            // eleven-character recovery code both arrive here, and a rule
            // narrow enough to tell them apart would also tell an attacker
            // which of the two the server was expecting.
            'code' => ['required', 'string', 'max:64'],
        ];
    }
}
