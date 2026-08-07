<?php

namespace Modules\Customers\Resources;

use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A customer as staff see them (ADR-0018) — deliberately a different
 * resource from `CustomerResource`, which is the account as the *customer*
 * sees it.
 *
 * Two resources rather than one with conditional fields, because the two
 * audiences differ in both directions. Staff see the suspension trail and
 * the order count, which are none of the customer's business to edit;
 * the customer sees nothing about who suspended them, which is a staff
 * name and not theirs to have.
 *
 * Neither carries `password` or `google_id` — the model hides both — and
 * this one adds no credential of any kind. A support agent never needs one.
 *
 * @mixin Customer
 */
class CustomerProfileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'name' => $this->name,
            'gender' => $this->gender?->value,
            'phone' => $this->phone,
            'email' => $this->email,
            'status' => $this->status,
            // How they can sign in, without saying what the credential is.
            // A support agent's first question on "I cannot log in" is
            // whether the account has a password at all or was created
            // through Google (ADR-0013 §3).
            'has_password' => $this->password !== null,
            'has_google' => $this->google_id !== null,
            'suspended_at' => $this->suspended_at,
            'suspension_reason' => $this->suspension_reason,
            'orders_count' => $this->whenCounted('orderRequests'),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
