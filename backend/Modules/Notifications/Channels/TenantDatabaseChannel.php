<?php

namespace Modules\Notifications\Channels;

use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Notifications\Notification as LaravelNotification;
use Modules\Notifications\Models\Notification;
use Modules\Notifications\Notifications\KangaruNotification;

/**
 * Writes the in-app row, tenant-scoped.
 *
 * Laravel's own database channel writes to a framework table keyed on a
 * `notifiable` morph with no tenant column. ADR-0001 requires one on every
 * tenant-owned table, and a notification quoting a passenger's name and a
 * booking's destination is tenant-owned by any reading.
 *
 * The rest of Laravel's notification machinery is kept — `via()`, queueing,
 * `Notification::fake()`, the mail channel — because reimplementing it
 * would be debt for no gain. Only where the row lands changes.
 */
class TenantDatabaseChannel
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function send(object $notifiable, LaravelNotification $notification): void
    {
        if (! $notifiable instanceof User || ! $notification instanceof KangaruNotification) {
            return;
        }

        // Taken from the recipient, not from TenantContext.
        //
        // These are queued, and a worker never passes through
        // IdentifyTenant — so the ambient tenant is whatever the last job
        // happened to leave bound, or nothing at all. Reading it here would
        // file a notification under another tenant on a busy worker, which
        // is the cross-tenant leak ADR-0001 calls the worst bug this
        // platform can have. The recipient's own tenant_id is the only
        // answer that cannot be wrong.
        $tenantId = $notifiable->tenant_id;

        if ($tenantId === null) {
            // Platform-level users (Super Admin has no tenant) have no
            // tenant-owned inbox to write to. Dropping the row is correct
            // and silent by design: nothing addressed to them is generated
            // by the three types built so far, so this is a guard rather
            // than a path.
            return;
        }

        // BelongsToTenant fills tenant_id from TenantContext on create when
        // it is not supplied, so it is supplied explicitly above. Bind it
        // too, or the model's own global scope — applied on insert-adjacent
        // reads — has nothing to work with inside a worker.
        $this->tenant->set($tenantId);

        Notification::create([
            'tenant_id' => $tenantId,
            'user_id' => $notifiable->id,
            'type' => $notification->type(),
            'subject' => $notification->subject(),
            'body' => $notification->body(),
            'url' => $notification->url(),
            'context' => $notification->context(),
        ]);
    }
}
