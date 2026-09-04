<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A passenger asking to be taken past the drop-off they agreed to.
 *
 * The same two fields the staff surface accepts, minus one: a passenger
 * cannot name a `client_place_id`. That register belongs to a corporate
 * client and ADR-0045 §10 releases it to one driver, on one live trip — a
 * passenger picking an id out of it would be reading a bank's ATM estate
 * from the back of a taxi.
 *
 * Coordinates stay optional and both-or-neither, exactly as everywhere else:
 * a passenger who typed a place name the geocoder could not find is still
 * telling their driver something useful, and a half-position is worse than
 * none. An extension with no pin is carried and billed on the trace like any
 * other leg; it simply does not steer the reference route (see
 * `RouteReference::extensionWaypoints`).
 */
class StoreRideExtensionRequest extends FormRequest
{
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
            // Required, unlike the staff shape: there is no saved place to
            // fall back on, so the passenger has to say where.
            'label' => ['required', 'string', 'max:160'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ];
    }
}
