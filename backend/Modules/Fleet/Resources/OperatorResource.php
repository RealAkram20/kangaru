<?php

namespace Modules\Fleet\Resources;

use App\Models\Operator;
use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A fleet company, as head office reads it (ADR-0055, ADR-0059).
 *
 * The counts are the point of the register: a name and a slug tell you
 * nothing about whether a fleet is running. They are `whenCounted`, so a
 * listing that did not ask for them pays for no query — and the controller
 * asks for them once, for the page, rather than per row.
 *
 * **Nothing here is a fleet's operational data.** No trips, no drivers by
 * name, no clients by name, no revenue. Head office counts what a fleet has;
 * to look at any of it, act as somebody there (ADR-0056). That line is the
 * whole of ADR-0055 §2 and it is easiest to cross by adding "just one more
 * useful field" to this file.
 *
 * @mixin Operator
 */
class OperatorResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'status' => $this->status,
            'is_active' => $this->status === 'active',
            // Which plan this fleet is on (ADR-0058 §1). Never null: a fleet
            // with no plan is a configuration error the creation path
            // refuses, not a state to render an em dash for.
            'plan' => $this->whenLoaded('plan', fn () => $this->plan instanceof Plan ? [
                'id' => $this->plan->id,
                'name' => $this->plan->name,
                'is_default' => $this->plan->is_default,
            ] : null),
            // The handover nobody has confirmed yet (owner's decision, 24
            // August). Name, address and expiry — enough for the record page
            // to say an invitation is out and to whom, and for head office to
            // notice one that lapsed. Never the token, which exists only
            // inside the email.
            'pending_owner' => $this->whenLoaded(
                'pendingOwnershipTransfer',
                fn () => $this->pendingOwnershipTransfer === null ? null : [
                    'name' => $this->pendingOwnershipTransfer->name,
                    'email' => $this->pendingOwnershipTransfer->email,
                    'expires_at' => $this->pendingOwnershipTransfer->expires_at->toIso8601String(),
                ],
            ),
            'users_count' => $this->whenCounted('users'),
            'drivers_count' => $this->whenCounted('drivers'),
            'vehicles_count' => $this->whenCounted('vehicles'),
            'clients_count' => $this->whenCounted('clients'),
            'created_at' => $this->created_at,
        ];
    }
}
