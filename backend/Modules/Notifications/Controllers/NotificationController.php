<?php

namespace Modules\Notifications\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Notifications\Models\Notification;
use Modules\Notifications\Requests\NotificationIndexRequest;
use Modules\Notifications\Resources\NotificationResource;

/**
 * A user's own inbox.
 *
 * There is no Policy here and that is deliberate, not an omission of the
 * kind AGENTS.md fails in review. A policy answers "may this user act on
 * that record?", which presumes a query that could return someone else's.
 * Every query in this controller is scoped to the authenticated user by
 * `scopeFor` *before* authorization would run, so there is no cross-user
 * read for a policy to forbid — and no role may read another person's
 * inbox, not even a tenant admin.
 *
 * Route-model binding is not used for the same reason: `findForUser` below
 * scopes by recipient, so another user's id is a 404 rather than a 403.
 * AGENTS.md: "404 also masks cross-tenant IDs; never return 403 for
 * another tenant's resource" — the same argument applies within a tenant to
 * something as personal as an inbox.
 */
class NotificationController extends Controller
{
    public function index(NotificationIndexRequest $request): JsonResponse
    {
        $user = $this->user($request->user());

        $notifications = Notification::query()
            ->for($user)
            ->when($request->unreadOnly(), fn ($query) => $query->unread())
            ->latest('id')
            ->limit($request->limit())
            ->get();

        return ApiResponse::success(
            NotificationResource::collection($notifications),
            meta: [
                // Served alongside the list rather than from a separate
                // endpoint: a bell shows a count and a panel shows the
                // list, and two round trips for one panel is a round trip
                // too many.
                'unread' => Notification::query()->for($user)->unread()->count(),
            ],
        );
    }

    public function markRead(int $notification): JsonResponse
    {
        $user = $this->user(request()->user());

        $record = Notification::query()->for($user)->find($notification);

        if ($record === null) {
            return ApiResponse::success(null, 'That notification could not be found.', 404);
        }

        $record->markRead();

        return ApiResponse::success(new NotificationResource($record), 'Marked as read.');
    }

    /**
     * Clears the badge in one call.
     *
     * A bulk update rather than a loop: an inbox left unattended for a
     * month is hundreds of rows, and this is the one place the module
     * writes more than one at a time. It bypasses the model's `updating`
     * guard by design — the guard exists to stop the *content* being
     * rewritten, and this touches nothing but `read_at`.
     */
    public function markAllRead(): JsonResponse
    {
        $user = $this->user(request()->user());

        $marked = Notification::query()->for($user)->unread()->update(['read_at' => now()]);

        return ApiResponse::success(
            ['marked' => $marked],
            $marked === 0 ? 'You had nothing unread.' : "Marked {$marked} notification(s) as read.",
        );
    }

    /**
     * Narrows the framework's `?Authenticatable` to the User every route
     * here already guarantees — these sit behind `auth:sanctum`.
     */
    private function user(mixed $user): User
    {
        abort_unless($user instanceof User, 401);

        return $user;
    }
}
