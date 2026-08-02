<?php

namespace Modules\Administration\Controllers;

use App\Enums\UserRole;
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

        $query = $user->role === UserRole::SUPER_ADMIN
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
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }
}
