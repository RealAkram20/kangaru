<?php

namespace Modules\Drivers\Requests;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;

/**
 * Approving an application (ADR-0027 §4).
 *
 * Carries the fields the applicant could not be trusted to supply. A licence
 * number is the obvious one: `drivers.license_number` is globally unique and
 * the fleet screen treats it as verified, so it comes from the reviewer who
 * held the document, never from the form.
 *
 * The role check mirrors `StoreDriverAccountRequest` exactly, because this
 * endpoint mints an account and ADR-0004's escalation rule does not care
 * which door that happened through.
 */
class ApproveDriverApplicationRequest extends FormRequest
{
    use ValidatesInlineVehicle;

    public function authorize(): bool
    {
        // DriverApplicationPolicy::decide, applied in the controller.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'license_number' => [
                'required',
                'string',
                'max:64',
                /**
                 * Globally unique, which is what a licence number is (see the
                 * Driver model). Caught here so the reviewer gets a sentence
                 * rather than an integrity violation mid-approval.
                 *
                 * **`whereNull('deleted_at')` removed, and its absence is the
                 * fix.** `drivers_license_number_unique` is a plain unique
                 * index over the whole column — it does not know about soft
                 * deletes, so a licence held by a deleted driver still
                 * reserves it. This rule excluded exactly those rows, so
                 * re-approving a re-applying driver passed validation and then
                 * violated the index: a 500 in the reviewer's face, mid-
                 * approval, saying nothing about what to do.
                 *
                 * `StoreDriverRequest` has always used the plain
                 * `Rule::unique('drivers')` and been right. ADR-0016 §5 names
                 * the underlying situation — a soft-deleted row goes on
                 * reserving a unique value against a driver nobody can see —
                 * and the honest answer is the 422 this now gives, not a
                 * validation rule that disagrees with the schema.
                 */
                Rule::unique('drivers', 'license_number'),
            ],
            // `after:today`, not `date`: onboarding somebody on an expired
            // licence is the one thing this field exists to prevent.
            'license_expiry' => ['required', 'date', 'after:today'],
            'vehicle_id' => ['sometimes', 'nullable', 'integer', Rule::exists('vehicles', 'id')],
            /**
             * Whose machine it is (ADR-0048 §7).
             *
             * The reviewer is the first person on this platform in a position
             * to say — a rider recruited at a stage almost always owns the
             * boda they applied on, and nothing in the application form asks.
             */
            'owns_vehicle' => ['sometimes', 'boolean'],
            /**
             * The vehicle itself, when the fleet has never seen it
             * (ADR-0048 §8).
             *
             * Very much the common case for this endpoint: a self-registered
             * rider arrives with a machine nobody has recorded, and sending
             * the reviewer to the Vehicles screen mid-approval is exactly the
             * abandoned half-finished state ADR-0027 §4 built one transaction
             * to prevent.
             */
            ...$this->inlineVehicleRules(),
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return $this->inlineVehicleMessages();
    }

    public function withValidator(Validator $validator): void
    {
        // The fleet picker and the inline form are mutually exclusive here
        // for the same reason they are on the driver form.
        $this->validateInlineVehicle($validator);

        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();

            if ($actor === null || $validator->errors()->isNotEmpty()) {
                return;
            }

            // Somebody who may not create accounts at all is not a
            // validation problem — answering 422 would mask the 403 the
            // controller is about to give. Same guard, same ordering
            // reasoning, as StoreDriverAccountRequest.
            if (! app(UserPolicy::class)->create($actor)) {
                return;
            }

            $slug = (string) ($this->input('role') ?? 'driver');
            $role = Role::query()->where('slug', $slug)->first();

            if (app(UserPolicy::class)->assignRole($actor, $role)) {
                return;
            }

            $validator->errors()->add(
                'role',
                'You cannot approve into that role: it carries permissions you do not hold yourself.',
            );
        });
    }
}
