<?php

namespace Modules\Bookings\Services;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Notifications\Notifications\OrderRequestReceivedNotification;

/**
 * The only writer of `order_requests` (ADR-0012). The public controller
 * hands validated input to receive(); the queue controller hands decisions
 * to move(). Nothing else touches the table.
 */
class OrderRequestService
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function receive(array $attributes): OrderRequest
    {
        $request = OrderRequest::query()->create([
            ...$attributes,
            'reference' => OrderRequest::mintReference(),
            'status' => OrderRequestStatus::NEW,
        ]);

        // Everyone who can work the queue hears about the new arrival.
        // Platform staff are a handful of rows, so filtering in memory is
        // simpler and safer than teaching the query builder to read each
        // role's permission JSON — and User::permissions() memoises per
        // instance, which is exactly right for a one-shot filter.
        $dispatchers = User::query()
            ->whereNull('tenant_id')
            ->get()
            ->filter(fn (User $user) => $user->isActive()
                && $user->hasPermission(Permission::ORDER_REQUESTS_MANAGE));

        Notification::send($dispatchers, OrderRequestReceivedNotification::for($request));

        return $request;
    }

    /**
     * @throws InvalidOrderRequestTransitionException
     */
    public function move(OrderRequest $request, OrderRequestStatus $to, User $actor, ?string $notes): OrderRequest
    {
        if (! in_array($to, $request->status->allowedTransitions(), true)) {
            throw new InvalidOrderRequestTransitionException($request->status, $to);
        }

        $request->update([
            'status' => $to,
            'handled_by_user_id' => $actor->id,
            // Coalesced so a bare status move doesn't erase earlier notes.
            'dispatcher_notes' => $notes ?? $request->dispatcher_notes,
        ]);

        return $request->refresh();
    }
}
