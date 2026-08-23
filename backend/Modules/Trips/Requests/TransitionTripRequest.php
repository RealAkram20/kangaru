<?php

namespace Modules\Trips\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Enums\TripStopStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripStop;
use Modules\Trips\Services\TripDistanceResolver;

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
            // **Required only while the platform is reading odometers**
            // (ADR-0047). With `tracking.odometer_enabled` off, the trace
            // prices the trip and a driver never sees the field — a required
            // rule would then 422 every Start Trip in the fleet, which is the
            // whole app broken by one switch.
            //
            // Still `integer, min:0` when it *is* sent. A handset that has not
            // picked up the new setting yet, or an operator who turned it off
            // mid-shift, keeps working: the reading is accepted and stored,
            // simply not demanded. Silently rejecting it would throw away the
            // one number the Bank's acceptance criterion #4 asks for, from the
            // drivers still recording it.
            'odometer_start' => [
                Rule::requiredIf(
                    $to === TripStatus::TRIP_STARTED->value && $this->odometerEnabled(),
                ),
                'integer',
                'min:0',
            ],
            'odometer_end' => [
                Rule::requiredIf(
                    $to === TripStatus::TRIP_COMPLETED->value && $this->odometerEnabled(),
                ),
                'integer',
                'min:0',
            ],
            // The handset's own measurement of the trip from its buffered
            // pings, in kilometres (ADR-0045 §5). Optional: a console user
            // and a handset that predates the field send none, and the
            // provisional fare is priced from the odometer instead. It is a
            // claim, not evidence — the resolver measures the trace itself.
            'provisional_distance_km' => ['nullable', 'numeric', 'min:0', 'max:100000'],
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
            // ADR-0045 §2: which stop this pause is an arrival at. Only
            // meaningful on `waiting` — the resume pairs itself with
            // whichever stop is open, so it carries none. Existence and
            // ownership are checked in withValidator against the route's
            // trip, because the check must run past the tenant scope.
            'stop_id' => ['nullable', 'integer'],
            'cancellation_charge_applicable' => ['nullable', 'boolean'],
            // Only consulted by the state machine on the Rejected ->
            // Assigned reassignment path.
            'vehicle_id' => [
                'nullable',
                'integer',
                Rule::exists('vehicles', 'id')->where(
                    fn ($query) => $query->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
            'driver_id' => [
                'nullable',
                'integer',
                Rule::exists('drivers', 'id')->where(
                    fn ($query) => $query->where('status', 'active')
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

            /*
             * The other end of the same rule (ADR-0035).
             *
             * Refused rather than flagged, and refused *here* rather than
             * downstream: past this point the reading is a trip, then a fare,
             * then a ledger entry or an invoice line, and correcting it means
             * somebody unpicking money.
             *
             * **How this reaches a driver is not immediate, and the message is
             * written for that.** The driver app queues the transition through
             * the offline outbox (ADR-0023) rather than sending it, so a 422
             * arrives on a later drain and parks the item with this message
             * attached — the driver reads it on the sync queue screen, not at
             * the kerb. It therefore has to name the figure and the limit and
             * be legible out of context, because by then the dashboard is not
             * in front of them. A console user gets it synchronously.
             *
             * The variance flag does not cover this case. It compares against
             * the GPS trace, declines to judge when there is no trace, and is
             * a review signal rather than a refusal — so an impossible reading
             * on a trip with no pings passed silently. One did: 90,004 km,
             * priced at UGX 198,013,800.
             *
             * The two odometer errors cannot both fire, and deliberately no
             * guard enforces that: a reading below the opening one makes
             * `$travelled` negative, which can never exceed a positive
             * ceiling. A first draft did guard on `errors()->has()` — a
             * mutation pass showed the guard was dead code, because the
             * arithmetic already guarantees it. The test below pins the
             * property rather than the guard, so it keeps holding if the
             * ceiling ever becomes something other than a subtraction.
             */
            if ($this->input('to') === TripStatus::TRIP_COMPLETED->value
                && $this->filled('odometer_end')
                && $trip?->odometer_start !== null) {
                $ceiling = (int) app(SettingsService::class)->get('tracking', 'odometer_max_km_per_trip');
                $travelled = $this->integer('odometer_end') - $trip->odometer_start;

                if ($travelled > $ceiling) {
                    $validator->errors()->add(
                        'odometer_end',
                        "That reading makes this trip {$travelled} km, which is beyond the {$ceiling} km "
                        .'allowed for one journey. Check the closing reading and try again.'
                    );
                }
            }

            if ($this->input('to') === TripStatus::CLOSED->value
                && $trip?->status === TripStatus::DISPUTED
                && ! $this->filled('notes')) {
                $validator->errors()->add('notes', 'Resolution notes are required to close a disputed trip.');
            }

            /*
             * ADR-0045 §2. Two refusals, both 422 rather than silence:
             *
             * - A stop on anything but a pause is a caller confused about
             *   the model — the arrive is the pause, the departure is the
             *   resume, and accepting the field elsewhere would let a
             *   client believe it did something.
             * - A stop that is not this trip's, or not pending, is refused
             *   in one sentence that deliberately does not distinguish
             *   "not yours" from "does not exist" — the same masking rule
             *   the routes apply. Queried past the tenant scope because a
             *   driver's request binds none and a walk-in's stops have none.
             */
            if ($this->filled('stop_id') && $trip !== null) {
                if ($this->input('to') !== TripStatus::WAITING->value) {
                    $validator->errors()->add('stop_id', 'A stop can only accompany a pause.');
                } elseif (! TripStop::query()->forTrip($trip)
                    ->whereKey($this->integer('stop_id'))
                    ->where('status', TripStopStatus::PENDING)
                    ->exists()) {
                    $validator->errors()->add('stop_id', 'That stop is not waiting to be visited on this trip.');
                }
            }
        });
    }

    /**
     * Whether the platform is reading odometers at all (ADR-0047).
     *
     * Asked through `TripDistanceResolver` rather than by reading the setting
     * directly, because the state machine asks the same question when it
     * decides where `distance_km` comes from — and a request that demanded a
     * reading the state machine then ignored, or omitted one it then needed,
     * is a pair of files disagreeing about the same switch. One answer, one
     * owner.
     */
    private function odometerEnabled(): bool
    {
        return app(TripDistanceResolver::class)->odometerEnabled();
    }
}
