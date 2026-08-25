<?php

namespace Modules\Fleet\Requests;

use App\Models\Operator;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Modules\Fleet\Services\OwnershipTransferService;

/**
 * Naming a fleet's next owner (owner's decision, 24 August).
 *
 * The address usually describes somebody with no account, and the account is
 * minted when they confirm rather than here. It no longer has to: an account
 * that is **free to move** is promoted at accept time instead, so an address
 * that already signs in is refused only when it belongs to another
 * organisation.
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
            // Uniqueness is no longer the rule. See `withValidator()`, which
            // asks the question this field actually has: not *does this
            // address have an account*, but *may that account take this fleet
            // over*.
            'email' => ['required', 'email'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $existing = User::query()->where('email', (string) $this->input('email'))->first();
            $operator = $this->route('operator');

            if ($existing === null || ! $operator instanceof Operator) {
                return;
            }

            /*
             * What this replaced was `Rule::unique('users', 'email')`, whose
             * comment said handing a fleet to an existing account was "a
             * different act this platform does not offer yet". It is offered
             * now, and the old rule had become the second half of a real
             * failure: an incoming owner filed a driver application overnight
             * — which mints an account at submission time (ADR-0055,
             * amendment) — after which head office could neither complete the
             * handover nor re-send it, because the address it had typed the
             * day before was suddenly "already taken".
             *
             * Mirrors `OwnershipTransferService::mayTakeOver()`, which is what
             * enforces this at accept time. Both exist deliberately: this one
             * so head office is told while it is still typing, that one
             * because a week can pass in between and the world can move.
             */
            $reason = OwnershipTransferService::ineligibleReason($existing, $operator);

            if ($reason !== null) {
                $validator->errors()->add('email', $reason);
            }
        });
    }
}
