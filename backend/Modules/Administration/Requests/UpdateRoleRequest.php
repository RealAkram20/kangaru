<?php

namespace Modules\Administration\Requests;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Role;

/**
 * Editing a role.
 *
 * A **system** role may have its permissions and description changed — a
 * client who wants Dispatchers to stop seeing rate cards should not need a
 * release — but not its slug or name. `users.role` stores the slug, and
 * renaming one would orphan every account holding it.
 */
class UpdateRoleRequest extends FormRequest
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
            'name' => ['sometimes', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:255'],
            'permissions' => ['sometimes', 'array', 'min:1'],
            'permissions.*' => ['string', Rule::enum(Permission::class)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();
            $bound = $this->route('role');

            // Resolved defensively rather than assuming the route parameter
            // has already been substituted for a model. It normally has —
            // SubstituteBindings runs first — but a validation rule that
            // silently does nothing when it hasn't is a guard that fails
            // open, and this one is protecting the last route back into
            // role administration.
            $role = $bound instanceof Role
                ? $bound
                : Role::query()->where('slug', $bound)->first();

            if ($actor === null || $role === null) {
                return;
            }

            if ($role->is_system && $this->filled('name') && $this->input('name') !== $role->name) {
                $validator->errors()->add(
                    'name',
                    'A built-in role cannot be renamed. Its permissions can be changed; create a custom role if you need a different name.',
                );
            }

            if (! $this->filled('permissions')) {
                return;
            }

            $requested = $this->input('permissions');

            if (! is_array($requested)) {
                return;
            }

            $beyond = array_diff(array_filter($requested, 'is_string'), $actor->permissions());

            if ($beyond !== []) {
                $validator->errors()->add(
                    'permissions',
                    'A role cannot grant permissions you do not hold yourself: '.implode(', ', $beyond),
                );
            }

            // Removing your own ability to edit roles leaves the catalogue
            // uneditable if you are the only holder — a one-click,
            // console-only recovery. Refused on your own role specifically;
            // stripping it from somebody else's is a decision, not a
            // mistake.
            if ($role->slug === $actor->roleSlug()
                && ! in_array(Permission::ROLES_MANAGE->value, $requested, true)
                && $actor->hasPermission(Permission::ROLES_MANAGE)) {
                $validator->errors()->add(
                    'permissions',
                    'You cannot remove role management from your own role. Ask another Super Admin to do it.',
                );
            }
        });
    }
}
