<?php

namespace Modules\Administration\Requests;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;

/**
 * Editing an account: name, email, role, status.
 *
 * Not the password. An administrator resetting someone's password silently
 * is exactly the act an audit trail cannot distinguish from an
 * impersonation, and nothing here needs it — a locked-out user is handled
 * by suspend/reactivate plus a fresh account, until a proper reset flow
 * exists. See the README.
 */
class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Every field optional: this is a PATCH, and an administrator changing
     * only a status must not have to resend a name and email they did not
     * look at.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        /** @var User|null $subject */
        $subject = $this->route('user');

        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => [
                'sometimes',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($subject?->id),
            ],
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();
            /** @var User|null $subject */
            $subject = $this->route('user');

            if ($actor === null || $subject === null) {
                return;
            }

            $policy = app(UserPolicy::class);

            // Same reason as StoreUserRequest: someone who may not
            // administer this account at all gets the controller's 403, not
            // a 422 about a field.
            if (! $policy->update($actor, $subject)) {
                return;
            }

            if ($this->filled('role')) {
                $role = Role::query()->where('slug', $this->input('role'))->first();

                if (! $policy->assignRole($actor, $role)) {
                    $validator->errors()->add(
                        'role',
                        'You cannot assign that role: it carries permissions you do not hold yourself.',
                    );
                }

                // Self-promotion, and equally self-demotion locking a tenant
                // out of its own administration.
                if ($actor->id === $subject->id && $role?->slug !== $actor->roleSlug()) {
                    $validator->errors()->add('role', 'You cannot change your own role.');
                }
            }

            if ($this->filled('status') && ! $policy->suspend($actor, $subject)) {
                $validator->errors()->add(
                    'status',
                    $actor->id === $subject->id
                        ? 'You cannot suspend your own account.'
                        : 'You cannot change the status of that account.',
                );
            }
        });
    }
}
