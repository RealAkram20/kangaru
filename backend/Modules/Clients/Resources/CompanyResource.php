<?php

namespace Modules\Clients\Resources;

use App\Enums\AccessLevel;
use App\Models\OperatorClient;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Clients\Models\Company;

/**
 * @mixin Company
 */
class CompanyResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'legal_name' => $this->legal_name,
            'trading_name' => $this->trading_name,
            'registration_number' => $this->registration_number,
            'industry' => $this->industry,
            'billing_email' => $this->billing_email,
            'phone' => $this->phone,
            'address_line1' => $this->address_line1,
            'address_line2' => $this->address_line2,
            'city' => $this->city,
            'country' => $this->country,
            'credit_limit_minor' => $this->credit_limit_minor,
            'status' => $this->status,

            /*
             * Who serves this client — **for head office and nobody else**.
             *
             * ADR-0062 §2 makes the directory Kangaru's, and head office
             * already chooses the fleet when it onboards, so it is entitled to
             * read back the answer it gave.
             *
             * The `when()` is not defensive tidiness. This resource is served
             * to fleets and to clients as well, and ADR-0060 §4 refuses one
             * specific disclosure: a fleet learning **which of its competitors
             * also serves its client**. An unconditional field here would hand
             * a fleet exactly that, on the register it reads every day, with
             * no endpoint having been added and nothing looking like a change
             * of scope.
             *
             * A list rather than one name, because a client may be served by
             * several fleets (ADR-0060). A single value would be a lie the
             * first time a second contract exists — and it would read as an
             * accurate one.
             */
            'served_by' => $this->when(
                $request->user() instanceof User
                    && $request->user()->access_level === AccessLevel::KANGARU,
                fn () => $this->whenLoaded(
                    'contracts',
                    fn () => $this->contracts
                        ->where('status', OperatorClient::ACTIVE)
                        ->map(fn (OperatorClient $contract) => [
                            'id' => $contract->operator_id,
                            'name' => $contract->operator?->name,
                        ])
                        ->values(),
                    [],
                ),
            ),

            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
