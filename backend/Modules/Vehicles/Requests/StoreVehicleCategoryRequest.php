<?php

namespace Modules\Vehicles\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * Creating a category — the **only** moment `key` is writable (ADR-0050 §2).
 *
 * The key is what lands on `vehicles.category` and, when a tariff prices it,
 * on `rate_card_rates.vehicle_category` and then on `invoice_lines`. Those
 * last two are immutable financial records, so this field is chosen once and
 * lives forever. It is worth being strict here in a way that would be fussy
 * anywhere else.
 */
class StoreVehicleCategoryRequest extends FormRequest
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
            'key' => [
                'required',
                'string',
                'max:40',
                // Lowercase, digits, single underscores. The shape the nine
                // existing keys already have, and the shape every consumer
                // assumes: `offerPresentation.ts` keys a label map on it,
                // the OpenAPI contract carries it as a plain string, and a
                // key with a space or a capital in it would read as a bug
                // in whichever of those rendered it first.
                'regex:/^[a-z0-9]+(_[a-z0-9]+)*$/',
                Rule::unique('vehicle_categories', 'key'),
            ],
            'name' => ['required', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:255'],
            'active' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'key.regex' => 'Use lowercase letters, numbers and underscores only — for example "minibus_14".',
            'key.unique' => 'That key is already taken by another category.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function categoryData(): array
    {
        return [
            'key' => $this->validated('key'),
            'name' => $this->validated('name'),
            'description' => $this->validated('description'),
            'active' => $this->boolean('active', true),
            // Appended rather than tied with an existing row; see
            // VehicleCategory::nextPosition().
            'position' => VehicleCategory::nextPosition(),
        ];
    }
}
