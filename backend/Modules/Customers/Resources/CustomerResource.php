<?php

namespace Modules\Customers\Resources;

use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The customer's own account, as shown to them. `google_id` and
 * `password` are hidden on the model; this resource narrows further to
 * exactly what the account screen needs.
 *
 * @mixin Customer
 */
class CustomerResource extends JsonResource
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
            // The composed form as well as the parts: the order form
            // prefills one field with it, and making every client
            // re-implement the join invites four spellings of it.
            'name' => $this->name,
            'gender' => $this->gender?->value,
            'phone' => $this->phone,
            'email' => $this->email,
            'created_at' => $this->created_at,
        ];
    }
}
