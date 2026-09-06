<?php

namespace Modules\Bookings\Requests;

use App\Enums\UserStatus;
use App\Models\OperatorClient;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Vehicles\Rules\ActiveVehicleCategory;

class StoreBookingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Every booking that predates ADR-0064 was a ride, and so is every
     * request from a client that has not learned the field — the default is
     * a statement about history, not a guess.
     */
    protected function prepareForValidation(): void
    {
        if (! $this->filled('service_type')) {
            $this->merge(['service_type' => OrderRequestServiceType::RIDE->value]);
        }

        // The named colleague's saved work number stands in when no number
        // was typed (owner's ask, 24 Aug). The dialog prefills the same
        // value visibly, so this is the API keeping the promise the screen
        // makes — a caller naming an account should not also have to copy a
        // number off it. A *typed* number still wins unconditionally: the
        // person raising the booking may know a better one for today, and
        // `filled()` is what keeps this from overwriting it. An account
        // with no saved number changes nothing, and the required rule then
        // says so on the field.
        if (! $this->filled('passenger_phone') && $this->filled('passenger_user_id')) {
            $phone = $this->passenger()?->phone;

            if ($phone !== null && $phone !== '') {
                $this->merge(['passenger_phone' => $phone]);
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $service = $this->input('service_type');

        return [
            // ADR-0064: which of the three services this asks for — the same
            // closed enum the walk-in form submits.
            'service_type' => ['required', Rule::enum(OrderRequestServiceType::class)],

            // Which client this booking is for, and only a fleet actor has
            // the question: a client's own user books for their one client,
            // applied by TenantContext, and the key is not even validated
            // for them — the same no-oracle reasoning as BookingIndexRequest,
            // where an `exists` rule for everybody let any corporate employee
            // enumerate the platform's client list one id at a time. Whether
            // the id names a client the fleet actually serves is checked in
            // withValidator, against active contracts only (ADR-0060 §4).
            ...($this->actorIsFleet()
                ? ['tenant_id' => ['required', 'integer']]
                : []),
            // Who is travelling, as one of the organisation's own people.
            //
            // Required for a client's staff and refused for nobody: a
            // Corporate Admin raising a car for a colleague names the
            // colleague, and the free-text name below stops being something
            // three people spell three ways. Shanitah's own desk keeps
            // typing names, because the walk-ins and callers they book for
            // have no account anywhere — see `withValidator`.
            'passenger_user_id' => ['sometimes', 'nullable', 'integer', 'exists:users,id'],
            'passenger_name' => ['required', 'string', 'max:255'],
            'passenger_phone' => ['required', 'string', 'max:32'],
            'passenger_count' => ['nullable', 'integer', 'min:1', 'max:60'],
            /*
             * ADR-0051. The kind of vehicle the client wants.
             *
             * Optional, and null is a real answer: "no preference" is the
             * ordinary case and the one every booking before this one has.
             *
             * Validated against the live vocabulary, so a client cannot ask
             * for a category the fleet does not run — and, since the rule
             * checks `active`, cannot ask for one it has stopped running.
             * **A retired category is not grandfathered here**, unlike on
             * `UpdateVehicleRequest`: a booking is a request being made now,
             * not a record predating the retirement.
             */
            'vehicle_category' => ['nullable', 'string', new ActiveVehicleCategory],
            // A ride and a delivery are journeys; a self-drive rental is not
            // — the renter collects the vehicle, so it has no route to state
            // (ADR-0064, the same split the walk-in form makes).
            'origin' => [
                Rule::requiredIf($service !== OrderRequestServiceType::SELF_DRIVE->value),
                'nullable', 'string', 'max:255',
            ],
            // ADR-0020 §2 — what the matcher ranks proximity by. Optional:
            // most staff-created bookings still arrive without them and
            // the recommender says so rather than guessing.
            'origin_latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:origin_longitude'],
            'origin_longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:origin_latitude'],
            'destination' => [
                Rule::requiredIf($service !== OrderRequestServiceType::SELF_DRIVE->value),
                'nullable', 'string', 'max:255',
            ],
            // Omit for an immediate booking. `after:now` rather than
            // `after_or_equal` so "scheduled for the past" is a validation
            // error rather than a booking the dispatcher can never honour.
            // The advance cap comes from platform settings (ADR-0014
            // phase 2): a booking a year out is a promise nobody has
            // priced, and the window is the owner's to set.
            //
            // Prohibited on a rental, whose period is details.start_date /
            // end_date — a `scheduled_for` beside them would be the second
            // clock the walk-in flow already got burned by: the self-drive
            // that auto-dispatched because its hire dates left this null and
            // "null means now" (OrderRequestServiceType's docblock).
            'scheduled_for' => [
                Rule::prohibitedIf($service === OrderRequestServiceType::SELF_DRIVE->value),
                'nullable', 'date', 'after:now',
                'before:+'.$this->maxAdvanceDays().' days',
            ],
            'notes' => ['nullable', 'string', 'max:1000'],

            'details' => ['nullable', 'array'],
            // Delivery. The parcel vocabulary is the walk-in form's
            // (StorePublicOrderRequest), verbatim — one fleet, one set of
            // package sizes. The recipient is required here where the public
            // form leaves them optional, because that form feeds a phone
            // call-back and this one feeds dispatch directly: a parcel with
            // nobody to ring at the far end is not a workable job, and a
            // booking has no edit endpoint to add them later.
            'details.item_type' => [
                'nullable',
                Rule::in(['documents', 'food', 'parcel', 'electronics', 'furniture', 'appliances', 'other']),
            ],
            'details.package_size' => ['nullable', Rule::in(['small', 'medium', 'large', 'heavy'])],
            'details.payer' => ['nullable', Rule::in(['sender', 'receiver'])],
            'details.payment_method' => ['nullable', Rule::in(['cash', 'mobile_money', 'card'])],
            'details.recipient_name' => [
                Rule::requiredIf($service === OrderRequestServiceType::DELIVERY->value),
                'nullable', 'string', 'max:120',
            ],
            'details.recipient_phone' => [
                Rule::requiredIf($service === OrderRequestServiceType::DELIVERY->value),
                'nullable', 'string', 'min:9', 'max:32', 'regex:/^[+0-9 ()-]+$/',
            ],
            'details.confirm_with_pin' => ['nullable', 'boolean'],
            // Self drive. The vehicle choice is NOT here — `vehicle_category`
            // above already asks it, against the live vocabulary rather than
            // the public form's hardcoded four.
            'details.start_date' => [
                Rule::requiredIf($service === OrderRequestServiceType::SELF_DRIVE->value),
                'nullable', 'date', 'after_or_equal:today',
            ],
            'details.end_date' => [
                Rule::requiredIf($service === OrderRequestServiceType::SELF_DRIVE->value),
                'nullable', 'date', 'after_or_equal:details.start_date',
            ],
            // Which identity documents the renter will bring, not the
            // documents themselves — the desk checks originals at collection.
            'details.kyc_documents' => ['nullable', 'string', 'max:255'],
        ];
    }

    /** ADR-0055: `isPlatformLevel()` means a fleet's own staff. */
    private function actorIsFleet(): bool
    {
        $actor = $this->user();

        return $actor instanceof User && $actor->isPlatformLevel();
    }

    /**
     * The colleague named as the passenger, once it is known they are one
     * of the caller's own and still working here. Null when none was named.
     */
    public function passenger(): ?User
    {
        $id = $this->input('passenger_user_id');

        if (! is_numeric($id)) {
            return null;
        }

        /** @var User|null $actor */
        $actor = $this->user();

        if ($actor === null) {
            return null;
        }

        // `forActor` is ADR-0006's named scoping, and `User` has no global
        // tenant scope of its own (see the model) — so this is the whole
        // isolation guard for the field. Without it one client could name
        // another's employee as a passenger and read their name and number
        // straight back out of the booking they just created.
        return User::forActor($actor)
            ->where('status', UserStatus::ACTIVE->value)
            ->find((int) $id);
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();

            if ($actor === null) {
                return;
            }

            // A client's booking is for a client's person. Shanitah's own
            // staff belong to no tenant (ADR-0006) and book for people who
            // have no account at all, so the field stays optional for them
            // and the typed name is the only name there is.
            if (! $actor->isPlatformLevel() && ! $this->filled('passenger_user_id')) {
                $validator->errors()->add(
                    'passenger_user_id',
                    'Choose the colleague who is travelling.',
                );

                return;
            }

            if ($this->filled('passenger_user_id') && $this->passenger() === null) {
                // Deliberately one message for two causes — not one of
                // yours, and no longer working here. Telling a caller which
                // it was turns this field into a directory oracle for
                // account ids they are guessing at.
                $validator->errors()->add(
                    'passenger_user_id',
                    'That is not somebody in your organisation.',
                );

                return;
            }

            $this->refuseClientTheFleetDoesNotServe($validator, $actor);
        });
    }

    /**
     * A fleet books **for a corporate client** (ADR-0064), and only for one
     * it holds an active contract with — `servedBy` is active contracts
     * only, so a fleet that has merely asked to serve a client cannot book
     * on their account either (ADR-0060 §4: asking grants nothing).
     *
     * One message for "no such client" and "not yours to book for", for the
     * reason BookingIndexRequest documents: two distinguishable answers are
     * an enumeration oracle for the platform's client list.
     */
    private function refuseClientTheFleetDoesNotServe(Validator $validator, User $actor): void
    {
        if (! $actor->isPlatformLevel() || $validator->errors()->has('tenant_id')) {
            return;
        }

        $tenantId = (int) $this->input('tenant_id');

        $served = OperatorClient::query()
            ->servedBy((int) $actor->operator_id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $served) {
            $validator->errors()->add(
                'tenant_id',
                'That is not a client your fleet serves.',
            );

            return;
        }

        // The named colleague must be the chosen client's person. Both
        // inputs are individually valid — the picker spans every client the
        // fleet serves — so this is the check that stops a bank's booking
        // carrying the telecom's employee because two dropdowns disagreed.
        $passenger = $this->filled('passenger_user_id') ? $this->passenger() : null;

        if ($passenger !== null && (int) $passenger->tenant_id !== $tenantId) {
            $validator->errors()->add(
                'passenger_user_id',
                'That person is not part of the chosen client.',
            );
        }
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'tenant_id.required' => 'Choose which client this booking is for.',
            'passenger_phone.required' => 'Give a number the driver can ring.',
            'scheduled_for.after' => 'A scheduled pickup must be in the future. Set it back to now for an immediate booking.',
            'scheduled_for.before' => "Bookings can be made up to {$this->maxAdvanceDays()} days ahead.",
            'scheduled_for.prohibited' => 'A rental has no pickup time — its dates are the hire period below.',
            'details.recipient_name.required' => 'Who receives this? The rider needs a name at the far end.',
            'details.recipient_phone.required' => 'A number for the recipient — the rider rings ahead.',
            'details.start_date.required' => 'Choose the day the rental starts.',
            'details.end_date.required' => 'Choose the day the rental ends.',
        ];
    }

    private function maxAdvanceDays(): int
    {
        return (int) app(SettingsService::class)->get('booking', 'max_advance_days');
    }
}
