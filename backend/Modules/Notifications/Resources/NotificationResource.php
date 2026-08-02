<?php

namespace Modules\Notifications\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Notifications\Models\Notification;

/**
 * @mixin Notification
 */
class NotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // The stable name, so a client can style or route by kind
            // without matching on the subject line.
            'type' => $this->type->value,
            'type_label' => $this->type->label(),
            'subject' => $this->subject,
            'body' => $this->body,
            // Relative and SPA-local; the client routes to it rather than
            // navigating, so the server never needs to know the frontend's
            // origin here (unlike the email, which does).
            'url' => $this->url,
            'context' => $this->context,
            'is_read' => $this->isRead(),
            'read_at' => $this->read_at,
            'created_at' => $this->created_at,
        ];
    }
}
