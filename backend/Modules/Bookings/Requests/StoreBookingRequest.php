<?php

namespace Modules\Bookings\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Modules\Administration\Services\SettingsService;

class StoreBookingRequest extends FormRequest
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
            'passenger_name' => ['required', 'string', 'max:255'],
            'passenger_phone' => ['required', 'string', 'max:32'],
            'passenger_count' => ['nullable', 'integer', 'min:1', 'max:60'],
            'origin' => ['required', 'string', 'max:255'],
            // ADR-0020 §2 — what the matcher ranks proximity by. Optional:
            // the internal booking dialog has no address autocomplete yet,
            // so most staff-created bookings still arrive without them and
            // the recommender says so rather than guessing.
            'origin_latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:origin_longitude'],
            'origin_longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:origin_latitude'],
            'destination' => ['required', 'string', 'max:255'],
            // Omit for an immediate booking. `after:now` rather than
            // `after_or_equal` so "scheduled for the past" is a validation
            // error rather than a booking the dispatcher can never honour.
            // The advance cap comes from platform settings (ADR-0014
            // phase 2): a booking a year out is a promise nobody has
            // priced, and the window is the owner's to set.
            'scheduled_for' => [
                'nullable', 'date', 'after:now',
                'before:+'.$this->maxAdvanceDays().' days',
            ],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'scheduled_for.after' => 'A scheduled pickup must be in the future. Leave it empty to request transport now.',
            'scheduled_for.before' => "Bookings can be made up to {$this->maxAdvanceDays()} days ahead.",
        ];
    }

    private function maxAdvanceDays(): int
    {
        return (int) app(SettingsService::class)->get('booking', 'max_advance_days');
    }
}
