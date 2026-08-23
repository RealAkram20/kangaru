<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Building a circuit (ADR-0045 §1).
 *
 * ## The stop ceiling is a provider limit, not a taste
 *
 * `MAX_STOPS` is 25 because that is what the routing provider will draw.
 * Google Directions accepts an origin, a destination and 23 intermediate
 * waypoints on the standard tier; a 40-stop circuit would save here and
 * then fail to render a line, which is a worse failure than a refusal —
 * the officer would have a saved route that silently has no shape.
 *
 * If a client genuinely runs more than 25 sites in a day, the honest answer
 * is two routes and two bookings, not a polyline the platform cannot draw.
 *
 * ## `exists` is not the isolation check
 *
 * `exists:client_places,id` says the row is real. It does **not** say it is
 * this client's, and it deliberately is not made to: a rule that filtered by
 * tenant here would report "invalid" for another client's id, which is the
 * same existence oracle in a politer voice. Ownership is decided in
 * `ClientRouteService` under the tenant scope, and refused there by name.
 */
class StoreClientRouteRequest extends FormRequest
{
    use ScopesUniquenessToActorTenant;

    /** @see the class docblock — this number is the provider's, not ours. */
    public const MAX_STOPS = 25;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => [
                'required', 'string', 'max:255',
                Rule::unique('client_routes', 'name')
                    ->where('tenant_id', $this->actorTenantId())
                    ->whereNull('deleted_at'),
            ],
            'reference' => ['nullable', 'string', 'max:40'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],

            // A route may be saved empty. An officer who pins three ATMs on
            // Friday and finishes the circuit on Monday has a draft, not an
            // error, and refusing it would cost them the three.
            'stops' => ['sometimes', 'array', 'max:'.self::MAX_STOPS],
            'stops.*.client_place_id' => ['required', 'integer', 'exists:client_places,id'],
            // A day is the ceiling because dwell is minutes at a site, not
            // a hire period; anything longer is a different product.
            'stops.*.expected_dwell_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'stops.*.driver_notes' => ['nullable', 'string', 'max:1000'],

            'member_ids' => ['sometimes', 'array', 'max:50'],
            'member_ids.*' => ['required', 'integer', 'exists:users,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.unique' => 'You already have a route with this name.',
            'stops.max' => 'A route can hold at most '.self::MAX_STOPS.' stops, which is what the mapping service will draw. Split a longer run into two routes.',
        ];
    }
}
