<?php

namespace Modules\Administration\Controllers;

use App\Enums\ClientCapability;
use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use App\Support\Database\SearchTerm;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;
use Modules\Administration\Requests\StoreUserRequest;
use Modules\Administration\Requests\UpdateUserRequest;
use Modules\Administration\Requests\UserIndexRequest;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\SettingsService;
use Modules\Administration\Services\UserAdminService;
use Modules\Clients\Models\ClientRoute;

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
            // `UserResource` emits `tenant_name` and `route_ids`; two
            // queries for the page, not two per row.
            ->with(['tenant', 'clientRoutes'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('role'), fn ($q) => $q->where('role', $request->string('role')))
            ->when($request->filled('q'), function ($q) use ($request) {
                // Wildcards in the term are escaped rather than honoured:
                // an administrator searching for `o_brien` means those
                // characters, not "any character here".
                $term = SearchTerm::contains((string) $request->string('q'));
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
                // The switches a client's administrator may set on their
                // people, with labels — served, so the screen keeps no copy.
                'capabilities' => ClientCapability::catalogue(),
                // The circuits this administrator may put somebody on
                // (ADR-0045 §8). Served with the list for the same reason
                // the roles are: the screen offers what the server says
                // exists, and never learns to build the list itself. Empty
                // for a platform account, which has no routes of its own.
                'routes' => $this->assignableRoutes(),
                // Whether an invitation can actually be delivered. `mail` is a
                // platform setting and it is off on production today, so the
                // console offers the choice only when the platform can keep
                // it — an Invite button that silently creates an unreachable
                // account is the hole the invitations table was built to
                // close, reopened from the other end.
                'can_invite' => app(SettingsService::class)->mailConfigured(),
            ],
        );
    }

    public function show(User $user): JsonResponse
    {
        $this->authorize('view', $user);

        return ApiResponse::success(new UserResource($user->load(['tenant', 'clientRoutes'])));
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $this->authorize('create', User::class);

        /** @var User $actor */
        $actor = $request->user();

        $created = $this->users->create($request->validated(), $actor);

        return ApiResponse::success(new UserResource($created->load(['tenant', 'clientRoutes'])), 'Account created.', 201);
    }

    public function update(UpdateUserRequest $request, User $user): JsonResponse
    {
        $this->authorize('update', $user);

        $wasActive = $user->isActive();

        /** @var User $actor */
        $actor = $request->user();

        $updated = $this->users->update($user, $request->validated(), $actor);

        // Suspension has to reach existing sessions. A Sanctum token issued
        // yesterday would otherwise keep working, so a dismissed employee
        // stays signed in on their phone while the staff list says
        // otherwise.
        if ($wasActive && ! $updated->isActive()) {
            $this->users->revokeTokens($updated);
        }

        return ApiResponse::success(new UserResource($updated->load(['tenant', 'clientRoutes'])), 'Account updated.');
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
     * The client's routes this actor may put a colleague on (ADR-0045 §8).
     *
     * `forActor` rather than a hand-written `where`: it is ADR-0006's one
     * named way past the tenant scope, and it is what makes this list a
     * client's own routes for a client's administrator and nothing at all
     * for a platform account — Shanitah's staff belong to no tenant, so
     * there is no "their routes" to offer, and returning every client's
     * would be a picker that leaks a customer list.
     *
     * @return array<int, array{id: int, name: string}>
     */
    private function assignableRoutes(): array
    {
        /** @var User $actor */
        $actor = request()->user();

        if ($actor->isPlatformLevel()) {
            return [];
        }

        return ClientRoute::query()
            ->forActor($actor)
            ->active()
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (ClientRoute $route) => ['id' => $route->id, 'name' => $route->name])
            ->all();
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
            // Two independent gates, and they answer different questions.
            //
            // `forLevel` asks whether a role belongs in this administrator's
            // world at all — a fleet owner is never offered a role written for
            // a bank's booking desk, however the permissions happen to line
            // up. `assignRole` asks whether *this* administrator may hand out
            // *this* grant, which is ADR-0004's escalation rule.
            //
            // Before the audience column the second was doing both jobs, and
            // only by coincidence: `corporate_admin` stayed out of a fleet
            // picker because its permission set happened not to be a subset,
            // not because anything said it did not belong there. The same
            // separation ADR-0059 §1 draws for the menu — level first, then
            // role — for the same reason.
            ->forLevel($actor->access_level)
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
