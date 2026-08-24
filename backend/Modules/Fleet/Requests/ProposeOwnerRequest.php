<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Naming a fleet's next owner (owner's decision, 24 August).
 *
 * Both fields describe a person who has no account yet — the account is
 * minted when they confirm, not here.
 */
class ProposeOwnerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            /*
             * Unique against every account, the sitting owner's included. An
             * address that already signs in belongs to somebody who already
             * has an identity here, and handing them a second account by the
             * transfer door would leave two people answering to one name.
             * Handing a fleet to an *existing* account is a different act
             * this platform does not offer yet, and refusing is honest about
             * that.
             */
            'email' => ['required', 'email', Rule::unique('users', 'email')],
        ];
    }
}
