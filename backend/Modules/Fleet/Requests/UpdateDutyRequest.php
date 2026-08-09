<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A driver going on or off duty (ADR-0024 §2).
 *
 * ## What this request deliberately cannot say
 *
 * There is no `driver_id`, for the reason `StoreDriverAvailabilityRequest`
 * has none: the driver is the caller, resolved from the token, and a field
 * naming somebody else is a field to tamper with. `/me/duty` has no id in
 * its path either.
 *
 * ## Why duty is an explicit act at all
 *
 * It could have been inferred — the app is open, therefore the driver is
 * working. It is not, because a driver who leaves the app running in their
 * pocket at home is not available, and a system that decides otherwise
 * sends offers into a void and then reports its own matcher as slow. A
 * boolean somebody pressed is a fact; a boolean inferred from a process
 * being alive is a guess about a person.
 */
class UpdateDutyRequest extends FormRequest
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
            // `boolean`, not `accepted`: going *off* duty is the same act in
            // the other direction, and `accepted` would refuse `false`.
            'on_duty' => ['required', 'boolean'],

            // Which vehicle they have the keys to today.
            //
            // Optional, and its absence is meaningful rather than an error:
            // a driver can be on duty before the depot has handed them
            // anything, and dispatch ranks them without a vehicle of their
            // own rather than refusing them (ADR-0020's rule — where an
            // input is missing, say so; do not substitute a guess).
            'vehicle_id' => [
                'nullable',
                'integer',
                // The fleet is platform-owned and unscoped by tenant
                // (ADR-0005), so `exists` needs no tenant clause here — and
                // adding one would be the mistake, not the safeguard.
                Rule::exists('vehicles', 'id')->whereNull('deleted_at'),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'vehicle_id.exists' => 'That vehicle is not on the fleet. Check the number with the depot.',
        ];
    }
}