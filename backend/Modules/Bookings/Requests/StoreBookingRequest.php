<?php

namespace Modules\Bookings\Requests;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Modules\Administration\Services\SettingsService;
use Modules\Vehicles\Rules\ActiveVehicleCategory;

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
            }
        });
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
