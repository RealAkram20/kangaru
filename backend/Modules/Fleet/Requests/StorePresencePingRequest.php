<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * An on-duty driver saying where they are (ADR-0024 §2).
 *
 * One point, not a batch. `POST /trips/{trip}/locations` takes a batch
 * because it is billing evidence and none of it may be lost — ADR-0023's
 * outbox exists to guarantee that. This is a dispatch radius: only the
 * newest point has any use, and a driver who was in a dead zone for ten
 * minutes should send where they are *now*, not replay where they were.
 * Queueing these would be storing a stale answer to a question about the
 * present.
 */
class StorePresencePingRequest extends FormRequest
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
            // Required as a pair. Half a point is not a point — the same
            // rule the public order form applies to its pickup, and for the
            // same reason: one coordinate resolved against a zero puts the
            // driver in the Gulf of Guinea.
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],

            // What the handset thinks of its own fix, in metres. Optional
            // because a device reports what it has, and kept because a
            // 2,000 m fix from a cell tower and a 5 m fix from GPS are very
            // different inputs to a proximity ranking.
            'accuracy_metres' => ['nullable', 'numeric', 'min:0', 'max:100000'],

            // The device's clock, not the server's — matching
            // `trip_locations.recorded_at`. It is what staleness is judged
            // against, and a server timestamp would make every ping look
            // fresh at the moment it finally arrived, which is exactly the
            // lie the field exists to prevent.
            'recorded_at' => ['required', 'date'],

            // A driver may swap vehicles mid-shift without signing out.
            // Absent means "unchanged", not "none".
            'vehicle_id' => ['nullable', 'integer', 'exists:vehicles,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'latitude.required' => 'A position needs both a latitude and a longitude.',
            'longitude.required' => 'A position needs both a latitude and a longitude.',
        ];
    }
}