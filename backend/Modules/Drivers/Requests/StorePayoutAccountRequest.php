<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Drivers\Enums\PayoutAccountKind;

/**
 * A driver saying where their money should be sent (ADR-0042).
 *
 * Authorisation is open here and settled in the controller, as
 * `StoreDriverPhotoRequest` and `UpdateDriverProfileRequest` both do it: the
 * driver is the token, so there is no id to authorise against — only a check
 * that the account has a driver profile.
 *
 * **Every field is required on every save**, unlike the profile PATCH beside
 * it. A payout destination is one fact made of four parts, and a partial update
 * would let a driver change the bank while leaving last month's account number
 * — which is a working destination pointing at the wrong place, the single
 * worst state this table can hold.
 */
class StorePayoutAccountRequest extends FormRequest
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
            /*
             * Derived from `account_number` by the model and refused loudly
             * here, the way `UpdateDriverProfileRequest` refuses the columns
             * the office keeps. A caller able to set it could store a tail that
             * does not belong to the number it claims to summarise — and the
             * tail is the only part the driver ever sees to check, so a wrong
             * one is a silent lie on the screen built to catch a mistake.
             */
            'last_four' => ['prohibited'],

            'kind' => ['required', Rule::enum(PayoutAccountKind::class)],
            'institution' => ['required', 'string', 'max:120'],
            'account_holder' => ['required', 'string', 'max:255'],
            /*
             * **No shape rule, and that is considered rather than lazy.**
             * Ugandan bank account numbers vary in length by bank; a
             * mobile-money number may be typed `+256700123456`, `0700123456`
             * or with spaces; and PRODUCT.md is East Africa first and
             * international after. A regex here would refuse a real account
             * and leave the driver unable to be paid, with no way to argue
             * with it — the same reasoning `UpdateDriverProfileRequest` gives
             * for not constraining a phone number.
             *
             * The floor is a length that cannot be an accident. `max` is well
             * clear of an IBAN, because a driver paid into a foreign account
             * is a thing that will happen before anybody thinks to change it.
             */
            'account_number' => ['required', 'string', 'min:4', 'max:64'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'account_number.min' => 'That does not look like a full account number.',
            'account_holder.required' => 'Whose account is this? Use the name on it.',
            'institution.required' => 'Which bank or provider is it?',
            'last_four.prohibited' => 'The last four digits are taken from the account number.',
        ];
    }
}
