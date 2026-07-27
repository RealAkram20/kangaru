<?php

namespace Modules\Administration\Resources;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin AuditLog
 */
class AuditLogResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'user_id' => $this->user_id,
            'user' => new UserResource($this->whenLoaded('user')),
            'auditable_type' => $this->auditable_type,
            'auditable_id' => $this->auditable_id,
            'action' => $this->action,
            'changes' => $this->changes,
            'ip_address' => $this->ip_address,
            'created_at' => $this->created_at,
        ];
    }
}
