<?php

namespace Modules\Administration\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * Changing your own password.
 *
 * Ships with staff administration rather than after it, because
 * administrators now hand out initial passwords: creating accounts without
 * giving their owners a way to take the password out of the administrator's
 * hands would be half a feature, and the wrong half.
 *
 * The current password is required even though the caller is already
 * authenticated. A bearer token proves the request came from a signed-in
 * session, not that the person holding it is the account's owner — an
 * unattended laptop is enough. This is the standard re-authentication step
 * before a credential change.
 */
class ChangePasswordRequest extends FormRequest
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
            'current_password' => ['required', 'string'],
            // `confirmed` requires a matching password_confirmation, so a
            // typo locks nobody out of their own account.
            //
            // Eight, matching `PasswordResetController` and
            // `StoreDriverApplicationRequest` — the three doors a driver can
            // reach from the phone. Accounts the office mints
            // (`StoreUserRequest`, `StoreDriverAccountRequest`) still hold
            // twelve; those are typed by staff at a desk, not by a driver on a
            // handset in the sun.
            'password' => ['required', 'string', 'confirmed', Password::min(8), 'different:current_password'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'password.different' => 'Your new password must be different from your current one.',
        ];
    }
}
