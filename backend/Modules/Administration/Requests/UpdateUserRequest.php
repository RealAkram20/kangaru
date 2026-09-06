<?php

namespace Modules\Administration\Requests;

use App\Enums\ClientCapability;
use App\Enums\RoleAudience;
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
            // Not nullable: an administrator may correct a number, and may
            // leave the field alone, but "save this person with no way to
            // reach them" is not a thing this screen offers.
            'phone' => ['sometimes', 'string', 'max:32'],
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
            // What a client's administrator may switch on for one of their
            // people (App\Enums\ClientCapability). The full list each time,
            // like `role`: a switch panel is saved whole, not one toggle at a
            // time, and "absent" must never mean "keep whatever was there"
            // for something that grants permissions.
            'capabilities' => ['sometimes', 'array'],
            'capabilities.*' => ['string', Rule::enum(ClientCapability::class)],
            'books_without_approval' => ['sometimes', 'boolean'],
            // Saved whole like `capabilities`, and for a weaker version of
            // the same reason: a roster edited one entry at a time cannot
            // express "took them off the Monday run". See StoreUserRequest
            // for why this carries no escalation check.
            'route_ids' => ['sometimes', 'array', 'max:50'],
            'route_ids.*' => ['required', 'integer', Rule::exists('client_routes', 'id')],
        ];
    }

    /**
     * The capabilities named in this request, as enum cases. Empty when the
     * field is absent or empty.
     *
     * @return array<int, ClientCapability>
     */
    public function capabilities(): array
    {
        $slugs = $this->input('capabilities');
        if (! is_array($slugs)) {
            return [];
        }

        return array_values(array_filter(array_map(
            fn ($slug) => is_string($slug) ? ClientCapability::tryFrom($slug) : null,
            $slugs,
        )));
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

                // Judged against the account being edited, not against the
                // administrator: a fleet's office may edit somebody at a
                // client it serves, and that person's roles are a client's.
                if (! $policy->assignRole($actor, $role, $subject->access_level)) {
                    $validator->errors()->add(
                        'role',
                        $role !== null && $role->audience !== RoleAudience::forLevel($subject->access_level)
                            ? 'That role is for a '.$role->audience->label().' account, not this one.'
                            : 'You cannot assign that role: it carries permissions you do not hold yourself.',
                    );
                }

                // Self-promotion, and equally self-demotion locking a tenant
                // out of its own administration.
                if ($actor->id === $subject->id && $role?->slug !== $actor->roleSlug()) {
                    $validator->errors()->add('role', 'You cannot change your own role.');
                }
            }

            // Capabilities widen a person's permissions, so they answer to
            // the same escalation rule as roles (ADR-0004): nobody grants
            // what they do not hold. And they are a client's switches for a
            // client's people — a platform account has no client, and its
            // abilities are its role's.
            if ($this->has('capabilities') || $this->has('books_without_approval')) {
                if ($subject->isPlatformLevel()) {
                    $validator->errors()->add(
                        'capabilities',
                        "Capabilities apply to a client's own staff, not to platform accounts.",
                    );
                }
                foreach ($this->capabilities() as $capability) {
                    if (! $actor->holdsAll(array_map(fn ($p) => $p->value, $capability->permissions()))) {
                        $validator->errors()->add(
                            'capabilities',
                            'You cannot grant "'.$capability->label().'": it carries permissions you do not hold yourself.',
                        );
                        break;
                    }
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
