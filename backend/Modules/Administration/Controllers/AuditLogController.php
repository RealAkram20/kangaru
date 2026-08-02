<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Api\ApiResponse;
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
        // tenant reads across all of them.
        $query = $user->tenant_id === null
            ? AuditLog::allTenants()
            : AuditLog::query();

        $query
            ->when(
                $request->filled('auditable_type'),
                fn ($q) => $q->where('auditable_type', $request->string('auditable_type')),
            )
            ->when(
                $request->filled('action'),
                fn ($q) => $q->where('action', $request->string('action')),
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
                ],
                // Whether this reader sees the whole platform or one tenant.
                // A Super Admin's log includes role changes, which carry a
                // null tenant_id and are invisible to a tenant-scoped read.
                'scope' => $user->tenant_id === null ? 'platform' : 'tenant',
            ],
        );
    }
}
