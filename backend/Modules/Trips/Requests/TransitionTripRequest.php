<?php

namespace Modules\Trips\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

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
            // Invoice Generated is excluded, and is the one state a client
            // may not ask for directly. It is applied by
            // Modules\Billing\Services\InvoiceService, inside the same
            // transaction that issues the invoice, so a trip can never sit
            // at Invoice Generated with no invoice behind it — a state that
            // is also unbillable afterwards, because billing only accepts a
            // trip at Trip Completed.
            //
            // Enforced here rather than in TripPolicy because it is not a
            // question of who may do it: nobody may, so 422 is the honest
            // answer and 403 would imply somebody could.
            'to' => ['required', Rule::enum(TripStatus::class)->except(TripStatus::INVOICE_GENERATED)],
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
            // PROJECT.md: "Driver-entered value plus a dashboard photo."
            //
            // Optional, not required. A camera that will not focus in the
            // dark at the start of an upcountry run must not be able to
            // strand a trip that is otherwise ready to go — the reading is
            // one of the Bank's six acceptance criteria and the photo is
            // not. Trips missing one are reported rather than refused; see
            // Modules/Trips/README.md.
            //
            // 10 MB accommodates an unresized phone photo. Anything larger
            // is a device sending something other than a dashboard.
            'odometer_photo' => [
                'nullable',
                'image',
                'mimes:jpeg,jpg,png,webp,heic',
                'max:10240',
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
            // Only a resolved Trip carries the fields the two rules below
            // read; typed explicitly so a route parameter that has not been
            // model-bound cannot silently skip the odometer check.
            $route = $this->route('trip');
            $trip = $route instanceof Trip ? $route : null;

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
