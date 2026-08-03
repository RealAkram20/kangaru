<?php

namespace Modules\Administration\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Models\Role;

/**
 * @mixin User
 */
class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->roleSlug(),
            // Additive fields only (AGENTS.md: new optional fields are
            // allowed within a version). /auth/me returns this same
            // resource, so an existing client keeps working and gains a
            // status it can ignore.
            // From the role record, not the enum: a custom role has no enum
            // case, and falling back to the slug keeps the field populated
            // if the row is somehow missing rather than fataling on a
            // nullable relation.
            'role_label' => $this->roleRecord instanceof Role ? $this->roleRecord->name : $this->roleSlug(),
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'is_active' => $this->isActive(),
            'deactivated_at' => $this->deactivated_at,
            'created_at' => $this->created_at,

            // ADR-0008. The client must never work out for itself which
            // roles need a second factor — that is the same drift ADR-0004
            // and ADR-0006 exist to prevent, and here it would mean a UI
            // deciding whether a control is enforced.
            //
            // Two separate facts, deliberately. `mfa_enabled` is "this user
            // has a factor" and belongs on any account; `must_enrol_mfa` is
            // "this user can currently do nothing else", which is what the
            // SPA routes on. A user can be neither, and a user in an
            // unprivileged role who enrolled voluntarily is the first
            // without the second.
            //
            // Neither exposes the secret: `$hidden` keeps that out of every
            // serialisation, and these are booleans derived from it.
            'mfa_enabled' => $this->hasMfaEnabled(),
            'must_enrol_mfa' => $this->mustEnrolInMfa(),
        ];
    }
}
