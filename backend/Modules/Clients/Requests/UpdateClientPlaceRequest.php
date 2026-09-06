<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Editing a pin — moving it, renaming it, retiring it.
 *
 * Every field is `sometimes`, so a PATCH that moves a pin does not have to
 * resend the notes to keep them. Coordinates keep `required_with` on each
 * other: a latitude arriving without its longitude would move the pin along
 * one axis only, which is a place nobody chose.
 *
 * @see StoreClientPlaceRequest for the swapped-pair hole these bounds
 *      cannot close.
 */
class UpdateClientPlaceRequest extends FormRequest
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
                Rule::unique('client_places', 'name')
                    ->where('tenant_id', $this->actorTenantId())
                    ->whereNull('deleted_at')
                    ->ignore($this->route('place')),
            ],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'latitude' => ['sometimes', 'required', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['sometimes', 'required', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'arrival_radius_m' => ['sometimes', 'nullable', 'integer', 'min:25', 'max:5000'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
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
