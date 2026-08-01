<?php

namespace Modules\Bookings\Requests;

use Illuminate\Foundation\Http\FormRequest;

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
            'destination' => ['required', 'string', 'max:255'],
            // Omit for an immediate booking. `after:now` rather than
            // `after_or_equal` so "scheduled for the past" is a validation
            // error rather than a booking the dispatcher can never honour.
            'scheduled_for' => ['nullable', 'date', 'after:now'],
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
        ];
    }
}
