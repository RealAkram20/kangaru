<?php

namespace Modules\Bookings\Services;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Notifications\Notifications\OrderRequestReceivedNotification;

/**
 * The only writer of `order_requests` (ADR-0012). The public controller
 * hands validated input to receive(); the queue controller hands decisions
 * to move(). Nothing else touches the table.
 */
class OrderRequestService
{
    public function __construct(private readonly DispatchOfferService $offers) {}

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

        $this->offerToDrivers($request);

        return $request;
    }

    /**
     * Starts the search for a driver, unattended (ADR-0024 §6).
     *
     * Hung off the same moment that notifies the desk, because it is the
     * same event: an order arrived and somebody has to act on it. ADR-0020
     * recorded that "nothing polls the queue and assigns unattended" as a
     * deliberate first step for a matcher nobody had watched; this is the
     * second step, taken for walk-ins only and behind its own flag.
     *
     * ## Why the desk is still notified
     *
     * The in-app notification is not replaced by this and must not be. The
     * matcher can come back empty — no driver on duty near the pickup, at
     * 04:00, in the rain — and ADR-0024 §4's answer to that is the order
     * returning to the human queue a dispatcher is already watching. If the
     * notification only fired when automatic dispatch failed, the desk would
     * learn to ignore a channel that is silent all day.
     *
     * ## Why failure is swallowed
     *
     * `receive()` is called from the one unauthenticated write in the
     * platform, and its contract is ADR-0012's: the visitor gets a reference
     * and a promise that somebody will call. A matcher that threw — no
     * presence store, a Redis outage, a bug in the ranking — would turn that
     * into a 500 on a public form, losing the order outright. Every failure
     * mode here degrades to exactly the behaviour the platform had before
     * ADR-0024: a request in the queue, and a dispatcher with a telephone.
     */
    private function offerToDrivers(OrderRequest $request): void
    {
        if (! config('dispatch.walk_in_auto_dispatch')) {
            return;
        }

        // A ride for later is not offered now. Holding an offer open for six
        // hours, or waking a matcher at 05:00 to find somebody for a 06:00
        // pickup, is a scheduler with its own decisions about how early to
        // start looking — deferred by name in ADR-0024.
        if ($request->scheduled_for !== null && $request->scheduled_for->isFuture()) {
            return;
        }

        try {
            $this->offers->dispatch($request);
        } catch (\Throwable $e) {
            Log::warning('dispatch.walk_in_offer_failed', [
                'order_request_id' => $request->id,
                'error' => $e->getMessage(),
            ]);
        }
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
