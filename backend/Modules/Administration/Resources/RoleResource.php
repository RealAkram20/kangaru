<?php

namespace Modules\Administration\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Models\Role;

/**
 * @mixin Role
 */
class RoleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            // The slug is the external reference: it is what `users.role`
            // stores and what the staff endpoints accept.
            'slug' => $this->slug,
            'name' => $this->name,
            'description' => $this->description,
            'is_system' => $this->is_system,
            'permissions' => $this->permissions ?? [],
            // Present only on the listing, which loads it. A role's holder
            // count is what decides whether it can be deleted, so showing
            // it saves a failed attempt.
            'users_count' => $this->whenCounted('users'),
            'created_at' => $this->created_at,
        ];
    }
}
