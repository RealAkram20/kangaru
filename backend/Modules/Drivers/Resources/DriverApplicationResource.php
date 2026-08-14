<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverApplication;

/**
 * An application as the office sees it (ADR-0027).
 *
 * The applicant never sees this — there is no endpoint that would show it to
 * them (ADR-0027 §6) — so everything here is written for a reviewer.
 *
 * `password` is absent and cannot be added by accident: the model hides it.
 * While an application is pending that column holds a live bcrypt hash of a
 * credential that is about to become an account's, which makes it the most
 * sensitive thing in the row.
 *
 * @mixin DriverApplication
 */
class DriverApplicationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'status' => $this->status,
            'status_label' => $this->status->label(),
            // When they agreed, not whether — the whole point of storing a
            // time (ADR-0027 §5). A reviewer asked to evidence consent needs
            // the date, and "true" would not be evidence of anything.
            'terms_accepted_at' => $this->terms_accepted_at,
            'reviewed_at' => $this->reviewed_at,
            // Flat, like `vehicle_id` on DriverResource and for the same
            // reason: a queue is read in bulk, and joining a user per row to
            // print a name is the N+1 AGENTS.md forbids.
            'reviewed_by_user_id' => $this->reviewed_by_user_id,
            'rejection_reason' => $this->rejection_reason,
            // Present once approved, so the queue can link straight to the
            // profile it produced rather than making a reviewer search for a
            // name they just read.
            'driver_id' => $this->driver_id,
            'created_at' => $this->created_at,
        ];
    }
}
