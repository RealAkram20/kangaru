<?php

namespace Modules\Trips\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A driver (or an office) extending a live run (ADR-0045 §4).
 *
 * Two shapes, one endpoint: a saved-place pick sends `client_place_id` alone
 * — label and pin are copied from the client's register by the service, so a
 * handset cannot mislabel an ATM — or free text sends `label` with an
 * optional coordinate pair.
 *
 * Whether the place actually belongs to the trip's client is deliberately
 * *not* checked here: that check must run past the tenant scope (a driver's
 * request binds no tenant), and `TripStopService::resolvePlace` owns it in
 * one place with the masking rule written down.
 */
class StoreTripStopRequest extends FormRequest
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
            'client_place_id' => ['nullable', 'integer'],
            // 160 matches the column, which matches `trips.origin`'s scale of
            // prose. Required only when no saved place carries the name.
            'label' => ['required_without:client_place_id', 'nullable', 'string', 'max:160'],
            // Both or neither — `TripResource::place` refuses half a
            // position, and a stop must not be the row that smuggles one in.
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ];
    }
}
