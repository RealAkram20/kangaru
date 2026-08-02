<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Models\Role;
use Modules\Administration\Requests\StoreRoleRequest;
use Modules\Administration\Requests\UpdateRoleRequest;
use Modules\Administration\Resources\RoleResource;

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
            ->withCount(['users' => fn ($q) => $q])
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

        $role->fill($request->safe()->only(['name', 'description', 'permissions']));
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
