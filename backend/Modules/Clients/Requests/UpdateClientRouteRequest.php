<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Editing a circuit — renaming it, reordering it, retiring it.
 *
 * `stops` and `member_ids` are `sometimes` and the service reads them with
 * `array_key_exists`, which is what separates **"not part of this edit"**
 * from **"the client emptied it"**. Without that distinction a PATCH that
 * only renames a route would wipe its stops, and the rename would look like
 * it worked.
 *
 * @see StoreClientRouteRequest for the stop ceiling and why `exists` is not
 *      the isolation check.
 */
class UpdateClientRouteRequest extends FormRequest
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
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('client_routes', 'name')
                    ->where('tenant_id', $this->actorTenantId())
                    ->whereNull('deleted_at')
                    ->ignore($this->route('route')),
            ],
            'reference' => ['sometimes', 'nullable', 'string', 'max:40'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],

            'stops' => ['sometimes', 'array', 'max:'.StoreClientRouteRequest::MAX_STOPS],
            'stops.*.client_place_id' => ['required', 'integer', 'exists:client_places,id'],
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
            'stops.max' => 'A route can hold at most '.StoreClientRouteRequest::MAX_STOPS.' stops, which is what the mapping service will draw. Split a longer run into two routes.',
        ];
    }
}
