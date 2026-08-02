<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Requests\AuditLogIndexRequest;
use Modules\Administration\Resources\AuditLogResource;

class AuditLogController extends Controller
{
    public function index(AuditLogIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', AuditLog::class);

        /** @var User $user */
        $user = $request->user();

        // Keyed off having no tenant rather than a role name, so a custom
        // platform-level role behaves the same way (ADR-0004). A tenant
        // user always gets TenantScope; only an account that belongs to no
        // tenant reads across all of them. One name for that since
        // ADR-0006 — this was one of the five hand-rolled copies.
        $query = AuditLog::forActor($user);

        $query
            ->when(
                $request->filled('auditable_type'),
                fn ($q) => $q->where('auditable_type', $request->string('auditable_type')),
            )
            ->when(
                $request->filled('action'),
                fn ($q) => $q->where('action', $request->string('action')),
            )
            ->when(
                $request->filled('user_id'),
                fn ($q) => $q->where('user_id', $request->integer('user_id')),
            )
            ->when(
                $request->filled('from'),
                fn ($q) => $q->where('created_at', '>=', Carbon::parse($request->string('from'))->startOfDay()),
            )
            // End of day, not midnight. `to=2026-03-31` means "including
            // everything that happened on the 31st"; comparing against the
            // bare date would silently drop that whole day, and a trail that
            // quietly omits a day is worse than one that refuses the query.
            ->when(
                $request->filled('to'),
                fn ($q) => $q->where('created_at', '<=', Carbon::parse($request->string('to'))->endOfDay()),
            )
            // Every column UserResource actually returns — a partial select
            // that omits one silently renders it null instead of erroring.
            // Whole, not a column list — see TripEventController for the
            // same fix. A select enumerating exactly the columns
            // UserResource reads couples the two silently: this endpoint
            // returned 500 the moment the resource gained a field, and no
            // test noticed because none of them render an audit row's
            // actor. It was found by calling the endpoint.
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->orderBy('id', 'desc');

        $paginator = $query->cursorPaginate(25);

        return ApiResponse::success(
            AuditLogResource::collection($paginator->getCollection()),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // What this endpoint will accept, so the reader's filters
                // hold no copy of it — the same reason RoleController ships
                // the permission catalogue. A client-side list is how the
                // whitelist here fell a decade behind the morph map.
                'filters' => [
                    'auditable_types' => AuditLogIndexRequest::auditableTypes(),
                    'actions' => AuditLogIndexRequest::ACTIONS,
                    'actors' => $this->actors($user),
                ],
                // Whether this reader sees the whole platform or one tenant.
                // A Super Admin's log includes role changes, which carry a
                // null tenant_id and are invisible to a tenant-scoped read.
                'scope' => $user->isPlatformLevel() ? 'platform' : 'tenant',
            ],
        );
    }

    /**
     * The people who actually appear in this reader's slice of the trail.
     *
     * Served rather than pointing the client at `/users`, because the two
     * are different questions and different permissions: `AuditLogPolicy`
     * exists so a custom "Auditor" role can read the log **without**
     * `staff.view`, and such a reader would get a 403 from the staff list.
     * This also answers the more useful question — who is in this log — in
     * place of every account that has ever existed.
     *
     * Scoped the same way the listing is, so a tenant reader never learns
     * the name of another tenant's administrator.
     *
     * @return array<int, array{value: int, label: string}>
     */
    private function actors(User $user): array
    {
        $ids = AuditLog::forActor($user)->whereNotNull('user_id')->distinct()->pluck('user_id');

        return User::query()
            ->whereIn('id', $ids)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $actor) => ['value' => $actor->id, 'label' => $actor->name])
            ->all();
    }
}
