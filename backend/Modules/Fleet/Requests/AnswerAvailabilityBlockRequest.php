<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Fleet\Enums\AvailabilityStatus;

/**
 * The fleet office answering a driver's request for time off (ADR-0017 §6).
 *
 * This is the endpoint the Driver's Application's requests arrive at the
 * other end of. `approved` is the only answer that actually withholds the
 * driver from dispatch.
 */
class AnswerAvailabilityBlockRequest extends FormRequest
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
            'status' => [
                'required',
                Rule::enum(AvailabilityStatus::class)
                    // `requested` is not an answer. Allowing it would let a
                    // decision be silently un-made, leaving a driver who was
                    // told yes back in the queue with no record of why.
                    ->only([AvailabilityStatus::APPROVED, AvailabilityStatus::DECLINED]),
            ],
            // Optional for a yes, and the note a "no" needs. Not required
            // even then: a required justification field is the one people
            // fill with a full stop, and the audit log records who answered
            // regardless.
            'note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
