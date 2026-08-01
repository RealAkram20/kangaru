<?php

namespace Modules\Bookings\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reject and cancel both require a reason — a booking that was refused with
 * no recorded why is exactly the kind of gap a bank audit picks up. Approve
 * uses its own (empty) rule set and does not route through here.
 */
class BookingDecisionRequest extends FormRequest
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
            'reason' => ['required', 'string', 'max:1000'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Please record why this booking is being turned down, so the requester can be told.',
        ];
    }
}
