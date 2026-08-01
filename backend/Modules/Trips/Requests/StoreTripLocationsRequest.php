<?php

namespace Modules\Trips\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates a batch of GPS pings before any of it is queued.
 *
 * ADR-0003 puts validation ahead of the buffer on purpose: a malformed ping
 * that reaches the queue fails in a worker where nobody is watching, and the
 * device that sent it has already been told everything was fine.
 */
class StoreTripLocationsRequest extends FormRequest
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
            'pings' => ['required', 'array', 'min:1', 'max:'.config('tracking.max_pings_per_request', 500)],

            // Ranges are the real thing being checked. A swapped
            // latitude/longitude pair is the classic GPS bug, and in Uganda
            // — near the equator and well inside ±90 on both axes — it
            // produces coordinates that look perfectly plausible. The bound
            // catches only the gross case; the ordering is a contract the
            // driver app has to honour.
            'pings.*.latitude' => ['required', 'numeric', 'between:-90,90'],
            'pings.*.longitude' => ['required', 'numeric', 'between:-180,180'],
            'pings.*.recorded_at' => ['required', 'date'],

            'pings.*.speed_kph' => ['nullable', 'numeric', 'min:0', 'max:400'],
            'pings.*.heading_degrees' => ['nullable', 'integer', 'min:0', 'max:359'],
            'pings.*.accuracy_metres' => ['nullable', 'numeric', 'min:0', 'max:10000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach ((array) $this->input('pings', []) as $index => $ping) {
                $recordedAt = is_array($ping) ? ($ping['recorded_at'] ?? null) : null;

                if (! is_string($recordedAt)) {
                    continue;
                }

                $timestamp = strtotime($recordedAt);

                // A ping from the future is a device with a wrong clock.
                // Accepting it would put the row in a partition ahead of
                // real time and silently stretch the trip's route; a little
                // slack absorbs ordinary clock skew.
                if ($timestamp !== false && $timestamp > time() + 300) {
                    $validator->errors()->add(
                        "pings.{$index}.recorded_at",
                        'This ping is timestamped in the future. Check the device clock.'
                    );
                }
            }
        });
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function pings(): array
    {
        /** @var array<int, array<string, mixed>> $pings */
        $pings = $this->validated('pings');

        return array_values($pings);
    }
}
