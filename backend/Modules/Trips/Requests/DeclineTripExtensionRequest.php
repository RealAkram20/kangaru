<?php

namespace Modules\Trips\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A driver refusing an extension a passenger asked for.
 *
 * The reason is optional, deliberately. A driver declining a job at the
 * roadside is not filling in a form, and demanding a sentence before they can
 * say no would either stall the answer or collect a keyboard-mash — neither
 * of which tells the office anything. `TripStopService::declineExtension`
 * writes a plain default when none is given, so the row always carries *some*
 * account of itself, which is what §6 asks of a skipped row.
 */
class DeclineTripExtensionRequest extends FormRequest
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
            // 200 matches `trip_stops.skip_reason`.
            'reason' => ['nullable', 'string', 'max:200'],
        ];
    }
}
