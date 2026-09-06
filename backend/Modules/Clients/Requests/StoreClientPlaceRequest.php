<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Pinning a location (ADR-0045 §1).
 *
 * ## What this cannot check, stated where the next reader will look
 *
 * Both coordinates are bounded to a real latitude and longitude, and that
 * is all bounds can do. **A swapped Kampala pair passes every rule here** —
 * 0.31 and 32.58 are each valid as either — and lands the pin in Somalia.
 * `StorePublicOrderRequest` records the same hole, and ADR-0020's
 * consequences record where it put a vehicle for real.
 *
 * The builder screen is the mitigation rather than this file: a place is
 * pinned by clicking a map, so the officer sees where it landed before they
 * save. That is a real answer, and it is worth knowing it is the *only* one.
 */
class StoreClientPlaceRequest extends FormRequest
{
    use ScopesUniquenessToActorTenant;

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
                // Matches the partial unique key on
                // (tenant_id, name, deleted_at) so the client gets a
                // sentence instead of an integrity constraint violation.
                // Scoped to the actor's own tenant, which is also what
                // stops this rule reporting that *another* client already
                // holds the name — a small existence oracle if it did.
                Rule::unique('client_places', 'name')
                    ->where('tenant_id', $this->actorTenantId())
                    ->whereNull('deleted_at'),
            ],
            'address' => ['nullable', 'string', 'max:255'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            // Floored at 25 m because consumer GPS does not resolve finer
            // and a tighter radius would mean arrivals that never register.
            'arrival_radius_m' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.unique' => 'You already have a saved place with this name.',
        ];
    }
}
