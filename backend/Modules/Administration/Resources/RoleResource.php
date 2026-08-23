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
            // ADR-0061. Editable since the second factor became a
            // setting; before that this column was reachable only from
            // a database client, and it was changed by hand three times.
            'requires_mfa' => (bool) $this->requires_mfa,
            // How many holders of this role have NOT set a factor up.
            // Turning the requirement on puts exactly these people into
            // the half-state at their next sign-in — a 200 with a token,
            // then a refusal on every route but five — so the console
            // says the number before anything is saved (ADR-0061 §4).
            'unenrolled_count' => $this->whenCounted('unenrolledUsers'),
            // Present only on the listing, which loads it. A role's holder
            // count is what decides whether it can be deleted, so showing
            // it saves a failed attempt.
            'users_count' => $this->whenCounted('users'),
            'created_at' => $this->created_at,
        ];
    }
}
