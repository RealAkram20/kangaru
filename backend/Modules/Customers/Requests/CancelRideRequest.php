<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A passenger calling off the ride they are watching (ADR-0024 §7).
 *
 * Carries a reason and nothing else — no id. The ride being cancelled is
 * whichever one is active for the token's own customer, for the same reason
 * `CustomerRideController::active` takes no identifier: ADR-0012 refused to
 * return anything enumerable, and accepting a `KR-` code here would hand back
 * the guessable lookup that ADR rejected.
 */
class CancelRideRequest extends FormRequest
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
             * Optional, and free text rather than an enum.
             *
             * `CANCEL_REASONS` in `frontend/src/pages/public/ride.ts` is a
             * closed list the screen offers, and it ends in "Something else"
             * — so the server would reject the one option that exists to
             * carry a sentence. It is also the customer's own words about
             * their own ride: validating the vocabulary of a complaint is how
             * an operator stops hearing the useful ones.
             *
             * Bounded, because it is stored, and unbounded free text on a
             * public-facing write is a column somebody eventually fills with
             * a novel.
             */
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
