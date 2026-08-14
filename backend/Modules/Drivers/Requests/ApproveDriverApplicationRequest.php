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
                // Globally unique, which is what a licence number is
                // (see the Driver model). Caught here so the reviewer gets
                // a sentence rather than an integrity violation mid-approval.
                Rule::unique('drivers', 'license_number')->whereNull('deleted_at'),
            ],
            // `after:today`, not `date`: onboarding somebody on an expired
            // licence is the one thing this field exists to prevent.
            'license_expiry' => ['required', 'date', 'after:today'],
            'vehicle_id' => ['sometimes', 'nullable', 'integer', Rule::exists('vehicles', 'id')],
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
        ];
    }

    public function withValidator(Validator $validator): void
    {
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
