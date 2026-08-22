<?php

namespace Modules\Administration\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Models\Role;
use Modules\Administration\Services\MfaService;

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
            // Additive. The console's chrome names whose console this is —
            // "Centenary Bank", not "Tenant 1" — and a client's user should
            // not have to fetch their own company to learn their own name.
            // Null for platform staff, who have no tenant (ADR-0006).
            //
            // Only when the relation was loaded: this resource is nested on
            // every booking, trip event and audit row as the actor, and a
            // lazy load per row is the N+1 `CrossClientQueueLabellingTest`
            // exists to catch. `/auth/*` and `/users*` load it; a nested
            // actor does not carry it and does not need to.
            'tenant_name' => $this->whenLoaded('tenant', fn () => $this->tenant?->name),
            // Which level this account belongs to (ADR-0055 §4). The console
            // chooses **which menu exists** from this before role narrows it
            // (ADR-0059 §1) — a fleet's dispatch board is not a thing in
            // Kangaru's world, and answering that with a role deny-list means
            // never forgetting one of six roles, forever.
            //
            // Unconditional rather than `whenLoaded`: it is a column on the
            // row, not a relation, so it costs no query wherever this resource
            // is nested. It is not a secret either — it is a fact about the
            // caller that the caller's own menu already reveals.
            'access_level' => $this->access_level->value,
            'name' => $this->name,
            'email' => $this->email,
            // The work number, so a booking raised for this person can be
            // dispatched against a number somebody already checked rather
            // than one retyped from memory each time.
            'phone' => $this->phone,
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
            // What a client's administrator switched on for this person
            // (App\Enums\ClientCapability), and whether their bookings need
            // approving. Additive; the labels travel in the staff list's
            // `meta.capabilities` catalogue, not here.
            'capabilities' => array_map(fn ($c) => $c->value, $this->capabilities()),
            'books_without_approval' => $this->booksWithoutApproval(),
            // The routes this person rides (ADR-0045 §8) — a roster, never
            // a permission. `whenLoaded` for the reason `tenant_name` is:
            // this resource is nested on every booking and audit row, and a
            // lazy load per row is the N+1 the staff list would pay for.
            'route_ids' => $this->whenLoaded(
                'clientRoutes',
                fn () => $this->clientRoutes->pluck('id')->all(),
            ),
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

            // ADR-0010 decision 3. `RECOVERY_CODE_LOW_WATER_MARK` was
            // defined by ADR-0008 and read by nothing, so a holder spent
            // codes one at a time and learned the count by running out —
            // with a lost phone, no code left, and no administrator able to
            // help, because ADR-0008 builds no reset on purpose.
            //
            // The *verdict* comes from MfaService rather than a comparison
            // written here, so "low" cannot come to mean one number in the
            // API and another on a screen. Null and false for an account
            // with no factor: zero remaining would read as "you have run
            // out" to somebody who never had any.
            'mfa_recovery_codes_remaining' => $this->when(
                $this->hasMfaEnabled(),
                fn () => app(MfaService::class)->remainingRecoveryCodes($this->resource),
            ),
            'mfa_recovery_codes_low' => $this->hasMfaEnabled()
                && app(MfaService::class)->recoveryCodesAreLow($this->resource),
        ];
    }
}
