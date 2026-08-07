<?php

namespace Modules\Administration\Requests;

use App\Support\Auth\ClientScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
            // ADR-0022, and declared again here rather than carried on the
            // challenge. The client is self-declared at login and cannot be
            // a defence against the person signing in — they may always ask
            // for a console token — so persisting it through the challenge
            // would add a column and a migration to protect nothing. What
            // it must do is let a driver-app login that happens to require
            // a factor still end up with a driver-scoped token, and asking
            // again does that.
            'client' => ['sometimes', Rule::in(ClientScope::clients())],
        ];
    }
}
