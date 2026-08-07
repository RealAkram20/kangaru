<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;

/**
 * A driver asking for time off, from the Driver's Application
 * (ADR-0017 §6, completing it).
 *
 * ## What this request deliberately cannot say
 *
 * There is no `resource_id`, no `resource_type` and no `status` field. All
 * three are set by the controller: the block is pinned to the caller's own
 * driver profile, as a driver, in the `requested` state.
 *
 * That is structural rather than validated, and the difference matters. A
 * shared endpoint with "you may only pass your own id" as a rule is one
 * forgotten check away from a driver booking leave for a colleague, or
 * granting themselves the `approved` status that withholds them from
 * dispatch. Here the fields simply do not exist to be sent.
 */
class StoreDriverAvailabilityRequest extends FormRequest
{
    public function authorize(): bool
    {
        // AvailabilityBlockPolicy::requestOwn, applied in the controller.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'kind' => [
                'required',
                // Only the reasons a *person* is away. A driver cannot ask
                // for `maintenance`; that is a thing that happens to a van,
                // and allowing it would make the utilisation report — which
                // exists to split "we lost days to the workshop" from "we
                // lost days to leave" — unreadable.
                Rule::in(AvailabilityKind::valuesForResource(AvailabilityResource::DRIVER)),
            ],
            'starts_at' => ['required', 'date'],
            // Optional, matching the office-side request: "off from Friday,
            // back when the funeral is over" is a real thing to ask for, and
            // the answer can pin the end date.
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            // The one thing only the driver knows, and what the fleet office
            // reads before answering.
            'reason' => ['required', 'string', 'min:5', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Say why you need the time off — the office reads this before answering.',
            'ends_at.after' => 'The last day has to be after the first.',
        ];
    }
}
