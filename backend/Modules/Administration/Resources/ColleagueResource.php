<?php

namespace Modules\Administration\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A colleague as a booking's passenger picker needs them.
 *
 * Three fields, and the shortness is the point — `UserResource` answers
 * "who is this account and what may it do", which is a staff
 * administrator's question. This answers "who is travelling and what number
 * does the driver ring", which is everyone's. Emitting the full user here
 * would put roles, capabilities and MFA state behind `bookings.create`.
 *
 * @mixin User
 */
class ColleagueResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            // Null for accounts made before the column existed. The booking
            // dialog prefills from it and lets the number be corrected, so a
            // colleague with none is still bookable — they are just typed
            // out once, which is what happened every time before this.
            'phone' => $this->phone,
        ];
    }
}
