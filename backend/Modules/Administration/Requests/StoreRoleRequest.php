<?php

namespace Modules\Administration\Requests;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Creating a custom role (ADR-0004).
 *
 * The permission list is validated against `App\Enums\Permission`, not
 * against a table: the catalogue lives in code, because a permission only
 * means anything if a policy checks it. A role granting an invented string
 * would confer nothing while appearing to confer something.
 */
class StoreRoleRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:120'],
            // Generated from the name when absent, so the caller does not
            // have to think about it — but accepted, because a slug is what
            // `users.role` stores and an operator may want to choose it.
            'slug' => [
                'sometimes', 'string', 'max:120',
                'regex:/^[a-z][a-z0-9_]*$/',
                Rule::unique('roles', 'slug'),
            ],
            'description' => ['nullable', 'string', 'max:255'],
            // Which level of account the role is for. Read only from head
            // office — see `audienceFor()`.
            'audience' => ['sometimes', Rule::enum(RoleAudience::class)],
            'permissions' => ['required', 'array', 'min:1'],
            'permissions.*' => ['string', Rule::enum(Permission::class)],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'slug.regex' => 'A role key may contain only lowercase letters, numbers and underscores, and must start with a letter.',
            'permissions.min' => 'A role has to grant at least one permission. A role that grants nothing is an account nobody can use.',
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();
            $requested = $this->input('permissions');

            if ($actor === null || ! is_array($requested)) {
                return;
            }

            // The escalation rule again, at the point a role is *defined*
            // rather than assigned. Without it, somebody holding
            // `roles.manage` but not `invoices.create` could author a role
            // carrying it and hand it out — the subset check on assignment
            // would then pass, because by then they would hold it.
            $beyond = array_diff(
                array_filter($requested, 'is_string'),
                $actor->permissions(),
            );

            if ($beyond !== []) {
                $validator->errors()->add(
                    'permissions',
                    'A role cannot grant permissions you do not hold yourself: '.implode(', ', $beyond),
                );
            }
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function roleAttributes(): array
    {
        $name = (string) $this->validated('name');

        return [
            'name' => $name,
            'slug' => $this->validated('slug') ?? Str::snake(Str::ascii($name)),
            'description' => $this->validated('description'),
            'audience' => $this->audienceFor(),
            'permissions' => array_values(array_unique($this->validated('permissions'))),
            'is_system' => false,
        ];
    }

    /**
     * Which audience the new role is composed for.
     *
     * **Head office chooses; everybody else composes for their own level.**
     * The same shape ADR-0061 §5 gave `requires_mfa`, and for a related
     * reason: a fleet Super Admin holds `roles.manage` and may compose roles
     * for their own fleet all day, but a role aimed at somebody else's kind of
     * account is a decision about the platform, not about a fleet.
     *
     * Defaulted rather than refused, because a role must have an audience —
     * one belonging to nobody would sit in the catalogue looking healthy and
     * appear in no picker at all. A fleet administrator composing a role means
     * a fleet role, and that is what they get whether they say so or not.
     */
    private function audienceFor(): RoleAudience
    {
        /** @var User $actor */
        $actor = $this->user();

        $chosen = $this->validated('audience');

        if ($chosen !== null && $actor->access_level === AccessLevel::KANGARU) {
            return RoleAudience::from((string) $chosen);
        }

        // An applicant never reaches here — `roles.manage` is not in their
        // grasp — but the null has to go somewhere, and a client role is the
        // narrowest thing to fall back to.
        return RoleAudience::forLevel($actor->access_level) ?? RoleAudience::CLIENT;
    }
}
