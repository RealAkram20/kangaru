<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Drivers\Enums\SettlementRequestKind;

/**
 * A driver raising a settlement request (ADR-0032).
 *
 * Authorisation is open here and settled in the controller: the driver is the
 * token, so there is no id to authorise against — only a check that the
 * account has a driver profile at all.
 */
class StoreSettlementRequest extends FormRequest
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
            'kind' => ['required', Rule::enum(SettlementRequestKind::class)],
            /**
             * Minor units, **positive, and an integer**.
             *
             * `min:1` rather than `min:0`: a request to settle nothing is not
             * a request, and letting one through would put an empty row in
             * the office's queue that nobody can action or dismiss.
             *
             * `integer` rather than `numeric` is the money rule from
             * AGENTS.md — a float here is the beginning of every rounding bug
             * this platform has rules to avoid. UGX is zero-decimal, so what
             * a driver types *is* the minor unit.
             */
            'amount_minor' => ['required', 'integer', 'min:1', 'max:100000000'],
            'note' => ['nullable', 'string', 'max:255'],
            /**
             * The trip a tip was taken on (ADR-0034 §1).
             *
             * **Required for a tip and refused for the other two kinds**, both
             * halves deliberately. A tip belongs to one journey and the office
             * has nothing to check the amount against without it; a remittance
             * covers a day's takings and a payout is a request against a
             * balance, so a trip on either would be a fact nobody asked for
             * sitting in a money record.
             *
             * `exists` only proves the trip is real. **That it is *this
             * driver's* trip is settled in the controller**, where the driver
             * is known — a form request that looked it up would be doing
             * authorization in a validator, and the failure mode is a driver
             * declaring a tip against somebody else's job.
             */
            'trip_id' => [
                Rule::requiredIf(
                    fn () => $this->input('kind') === SettlementRequestKind::TIP->value,
                ),
                Rule::prohibitedIf(
                    fn () => $this->input('kind') !== SettlementRequestKind::TIP->value,
                ),
                'integer',
                'exists:trips,id',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'amount_minor.min' => 'Enter how much, in shillings.',
            'amount_minor.integer' => 'Enter whole shillings, with no decimal point.',
        ];
    }
}
