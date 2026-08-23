<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\Driver;

/**
 * @mixin Driver
 */
class DriverResource extends JsonResource
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
            'license_number' => $this->license_number,
            'license_expiry' => $this->license_expiry,
            'status' => $this->status,
            // The vehicle they drive. Served flat rather than as a nested
            // object: a driver list is read to answer "who is out in what",
            // and eager-loading a vehicle per row for a registration number
            // is the N+1 AGENTS.md forbids.
            'vehicle_id' => $this->vehicle_id,
            /**
             * Whose vehicle that is (ADR-0048 §7).
             *
             * Sent even when `vehicle_id` is null, and the combination is
             * meaningful rather than contradictory: a boda rider recorded as
             * owning a machine the fleet has not registered yet is
             * `owns_vehicle: true, vehicle_id: null`, which is a driver the
             * office still owes a vehicle record. A screen that inferred
             * ownership from the id could not draw that state at all.
             */
            'owns_vehicle' => (bool) $this->owns_vehicle,
            /**
             * Enough of the vehicle to name it on a row, and no more.
             *
             * **Flat and shallow, on purpose**, for the reason the comment
             * above gives about `vehicle_id`: a driver list is read to answer
             * "who is out in what", and the answer is a number plate. The
             * full record is one request away on the fleet screen, and
             * nesting it here would put make, model, year, VIN, seats and
             * status on every row of a list nobody reads them from.
             *
             * `whenLoaded` rather than `$this->vehicle`: without the relation
             * eager-loaded this is one query per row (AGENTS.md), and the
             * guard makes that a visibly missing key in development rather
             * than a quietly slow list in production.
             */
            'vehicle' => $this->whenLoaded('vehicle', fn (): ?array => $this->vehicle === null ? null : [
                'id' => $this->vehicle->id,
                'registration_number' => $this->vehicle->registration_number,
                'make' => $this->vehicle->make,
                'model' => $this->vehicle->model,
            ]),
            // Whether this driver can sign in, and as whom (ADR-0016).
            //
            // Always present, never conditional on the relation being
            // loaded: a key that appears only sometimes is worse than a
            // null, because a screen reading it cannot tell "no account"
            // apart from "not asked for" and would render an Attach button
            // to a driver who already has one.
            //
            // No password material of any kind crosses this, and no token.
            // The account's *status* is here because a suspended login is
            // exactly what a fleet manager is looking for when a driver
            // says the app will not let them in.
            'account' => $this->accountSummary(),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function accountSummary(): ?array
    {
        $account = $this->user;

        if ($account === null) {
            return null;
        }

        return [
            'id' => $account->id,
            'email' => $account->email,
            'role' => $account->roleSlug(),
            'status' => $account->status,
        ];
    }
}
