<?php

namespace Modules\Trips\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Trips\Enums\TripStatus;

/**
 * One generic request for every transition — field-level (422) validation
 * only. Whether the transition is *legal from the trip's current state*
 * is deliberately not checked here; that's TripStateMachine's job and
 * returns 409, per AGENTS.md.
 */
class TransitionTripRequest extends FormRequest
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
        $to = $this->input('to');
        $tenantId = app(TenantContext::class)->get();
        $reasonRequired = in_array($to, [
            TripStatus::CANCELLED->value,
            TripStatus::REJECTED->value,
            TripStatus::NO_SHOW->value,
            TripStatus::DISPUTED->value,
        ], true);

        return [
            'to' => ['required', Rule::enum(TripStatus::class)],
            'notes' => [$reasonRequired ? 'required' : 'nullable', 'string', 'max:1000'],
            'odometer_start' => [
                Rule::requiredIf($to === TripStatus::TRIP_STARTED->value),
                'integer',
                'min:0',
            ],
            'odometer_end' => [
                Rule::requiredIf($to === TripStatus::TRIP_COMPLETED->value),
                'integer',
                'min:0',
            ],
            'cancellation_charge_applicable' => ['nullable', 'boolean'],
            // Only consulted by the state machine on the Rejected ->
            // Assigned reassignment path.
            'vehicle_id' => [
                'nullable',
                'integer',
                Rule::exists('vehicles', 'id')->where(
                    fn ($query) => $query->where('tenant_id', $tenantId)
                        ->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
            'driver_id' => [
                'nullable',
                'integer',
                Rule::exists('drivers', 'id')->where(
                    fn ($query) => $query->where('tenant_id', $tenantId)
                        ->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $trip = $this->route('trip');

            if ($this->input('to') === TripStatus::TRIP_COMPLETED->value
                && $this->filled('odometer_end')
                && $trip?->odometer_start !== null
                && $this->integer('odometer_end') < $trip->odometer_start) {
                $validator->errors()->add(
                    'odometer_end',
                    'Closing odometer reading cannot be less than the opening reading.'
                );
            }

            if ($this->input('to') === TripStatus::CLOSED->value
                && $trip?->status === TripStatus::DISPUTED
                && ! $this->filled('notes')) {
                $validator->errors()->add('notes', 'Resolution notes are required to close a disputed trip.');
            }
        });
    }
}
