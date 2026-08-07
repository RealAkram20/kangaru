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
