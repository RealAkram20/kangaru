<?php

namespace Modules\Administration\Controllers;

use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;
use Modules\Administration\Requests\StoreUserRequest;
use Modules\Administration\Requests\UpdateUserRequest;
use Modules\Administration\Requests\UserIndexRequest;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\UserAdminService;

/**
 * Staff administration.
 *
 * Until this existed, every account in the platform came from a seeder —
 * there was no way to onboard a colleague, change someone's role, or take
 * access away when they left.
 *
 * **Tenant scoping is manual here and must stay that way.** `User`
 * deliberately has no `BelongsToTenant`: login has to find an account by
 * email before any tenant is known, and Super Admins have no tenant at all.
 * So nothing scopes these queries automatically, and a forgotten `where`
 * leaks names, emails and roles across tenants. The scoping is applied in
 * `scopedQuery()` below and asserted directly by `UserAdminTest` — "never
 * shows a Corporate Admin the platform accounts or another tenant's" and
 * "refuses a Corporate Admin another tenant's account directly".
 */
class UserController extends Controller
{
    public function __construct(private readonly UserAdminService $users) {}

    public function index(UserIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', User::class);

        $query = $this->scopedQuery()
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('role'), fn ($q) => $q->where('role', $request->string('role')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.$request->string('q').'%';
                $q->where(fn ($w) => $w->where('name', 'like', $term)->orWhere('email', 'like', $term));
            })
            // Suspended accounts last: a staff list is read to find someone
            // who works here, and the people who no longer do should not be
            // in the way of that.
            ->orderByRaw("status = '".UserStatus::SUSPENDED->value."'")
            ->orderBy('name');

        return ApiResponse::success(
            UserResource::collection($query->get()),
            meta: [
                // What the client may offer in a role picker, so it does not
                // hold its own copy of the escalation rule. A Corporate
                // Admin never sees Super Admin in the list.
                'assignable_roles' => $this->assignableRoles(),
            ],
        );
    }

    public function show(User $user): JsonResponse
    {
        $this->authorize('view', $user);

        return ApiResponse::success(new UserResource($user));
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $this->authorize('create', User::class);

        /** @var User $actor */
        $actor = $request->user();

        $created = $this->users->create($request->validated(), $actor);

        return ApiResponse::success(new UserResource($created), 'Account created.', 201);
    }

    public function update(UpdateUserRequest $request, User $user): JsonResponse
    {
        $this->authorize('update', $user);

        $wasActive = $user->isActive();

        $updated = $this->users->update($user, $request->validated());

        // Suspension has to reach existing sessions. A Sanctum token issued
        // yesterday would otherwise keep working, so a dismissed employee
        // stays signed in on their phone while the staff list says
        // otherwise.
        if ($wasActive && ! $updated->isActive()) {
            $this->users->revokeTokens($updated);
        }

        return ApiResponse::success(new UserResource($updated), 'Account updated.');
    }

    /**
     * Every account this actor may administer.
     *
     * A platform-level account administers all of them; everyone else sees
     * their own tenant's. That rule is `User::scopeForActor` since ADR-0006
     * — the same name every other cross-tenant read now uses, written out
     * by hand here until then.
     *
     * @return Builder<User>
     */
    private function scopedQuery()
    {
        /** @var User $actor */
        $actor = request()->user();

        return User::forActor($actor);
    }

    /**
     * The roles this actor may hand out — every role whose permissions are
     * a subset of their own (ADR-0004's escalation rule).
     *
     * Served so the client keeps no copy of that rule: a role carrying
     * something the actor lacks is simply never sent, rather than the
     * frontend being trusted to filter it.
     *
     * @return array<int, array{value: string, label: string, description: string|null}>
     */
    private function assignableRoles(): array
    {
        /** @var User $actor */
        $actor = request()->user();
        $policy = app(UserPolicy::class);

        return Role::query()
            ->orderByDesc('is_system')
            ->orderBy('name')
            ->get()
            ->filter(fn (Role $role) => $policy->assignRole($actor, $role))
            ->map(fn (Role $role) => [
                'value' => $role->slug,
                'label' => $role->name,
                'description' => $role->description,
            ])
            ->values()
            ->all();
    }
}
