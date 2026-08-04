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
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'created_at' => $this->created_at,
        ];
    }
}
