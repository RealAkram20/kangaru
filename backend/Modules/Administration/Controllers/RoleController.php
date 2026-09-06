<?php

namespace Modules\Administration\Controllers;

use App\Enums\AccessLevel;
use App\Enums\ErrorCode;
use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Models\Role;
use Modules\Administration\Requests\StoreRoleRequest;
use Modules\Administration\Requests\UpdateRoleRequest;
use Modules\Administration\Resources\RoleResource;
use Modules\Administration\Services\SettingsService;

/**
 * The role catalogue (ADR-0004).
 *
 * Platform-wide and curated by whoever holds `roles.manage` — Super Admin
 * alone, as seeded. Not tenant-scoped, deliberately: there is one
 * catalogue and every tenant picks from it, so a tenant can never compose
 * a permission set for itself.
 */
class RoleController extends Controller
{
    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Role::class);

        /** @var User $actor */
        $actor = request()->user();

        $roles = Role::query()
            ->orderByDesc('is_system')
            ->orderBy('name')
            // `unenrolledUsers` so the console can say how many people a
            // second-factor switch would ask to enrol, before it is
            // thrown (ADR-0061 §4).
            ->withCount(['users' => fn ($q) => $q, 'unenrolledUsers'])
            ->get();

        return ApiResponse::success(
            RoleResource::collection($roles),
            meta: [
                // The catalogue itself, grouped, so the role editor renders
                // checkboxes without holding its own list of what exists.
                'catalogue' => self::catalogue(),
                // What this actor may put into a role — the escalation rule
                // at definition time.
                'grantable' => $actor->permissions(),
                'can_manage' => $actor->hasPermission(Permission::ROLES_MANAGE),
                // The three audiences, with their labels, so the editor's
                // picker and the listing's filter keep no copy of the list —
                // the same reason `catalogue` is served rather than hardcoded.
                'audiences' => RoleAudience::catalogue(),
                // Only head office decides which kind of account a role is
                // for; everybody else composes for their own level and the
                // control is not offered. Same shape as `can_manage_mfa`.
                'can_manage_audience' => $actor->access_level === AccessLevel::KANGARU
                    && $actor->hasPermission(Permission::ROLES_MANAGE),
                // ADR-0061. Whether the platform is asking for a second
                // factor at all. Sent here rather than left to the console to
                // fetch from `/settings`, which needs `settings.manage` — a
                // Corporate Admin reads this page and holds no such thing,
                // and a per-role badge that could not say "off platform-wide"
                // would be a control that looks live and does nothing.
                'mfa_enforced' => app(SettingsService::class)->mfaEnforced(),
                // Only head office may change the per-role half (ADR-0061 §5):
                // a control that weakens authentication must not be reachable
                // by the account it would weaken. The console reads this
                // rather than holding its own copy of the rule.
                'can_manage_mfa' => $actor->access_level === AccessLevel::KANGARU
                    && $actor->hasPermission(Permission::ROLES_MANAGE),
            ],
        );
    }

    public function store(StoreRoleRequest $request): JsonResponse
    {
        $this->authorize('create', Role::class);

        $role = Role::create($request->roleAttributes());

        return ApiResponse::success(new RoleResource($role), 'Role created.', 201);
    }

    public function update(UpdateRoleRequest $request, Role $role): JsonResponse
    {
        $this->authorize('update', $role);

        $role->fill($request->safe()->only(['name', 'description', 'audience', 'permissions', 'requires_mfa']));
        $role->save();

        return ApiResponse::success(new RoleResource($role), 'Role updated.');
    }

    public function destroy(Role $role): JsonResponse
    {
        $this->authorize('delete', $role);

        // A data question rather than a permission one, so it lives here:
        // deleting a role somebody holds would leave those accounts
        // resolving to no permissions at all. They fail closed, which means
        // a silent, total loss of access rather than an error anyone can
        // read.
        $holders = $role->users()->count();

        if ($holders > 0) {
            return ApiResponse::error(
                ErrorCode::ROLE_IN_USE,
                "This role cannot be deleted because {$holders} account(s) still hold it. ".
                'Move them to another role first.',
                [],
                409,
            );
        }

        $role->delete();

        return ApiResponse::success(message: 'Role deleted.');
    }

    /**
     * The permission catalogue, grouped for display.
     *
     * @return array<string, array<int, array{value: string, label: string}>>
     */
    private static function catalogue(): array
    {
        $grouped = [];

        foreach (Permission::cases() as $permission) {
            $grouped[$permission->group()][] = [
                'value' => $permission->value,
                'label' => $permission->label(),
            ];
        }

        return $grouped;
    }
}
