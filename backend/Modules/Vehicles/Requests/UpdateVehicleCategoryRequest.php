<?php

namespace Modules\Vehicles\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Renaming, redescribing, reordering and retiring a category.
 *
 * **`key` is absent from this list, and that absence is the decision**
 * (ADR-0050 §2). Not "validated carefully" — not accepted, so there is no
 * path through which a controller change could ever reach the column.
 *
 * Renaming a key would leave every historical invoice line and every
 * immutable rate card rate holding a string that names nothing. There would
 * be no error: the vehicle would dispatch, the invoice would render, and the
 * only symptom would be a document that no longer reproduces from stored
 * data — which is the one claim `PRODUCT.md` makes about this platform.
 *
 * `name` is what every screen renders, and it is freely editable forever.
 * Getting the *label* wrong is the mistake people actually make; nobody
 * outside this repository ever sees `suv`.
 *
 * `active: false` is what "delete" means for a category anything has ever
 * used, and it is never refused — see `VehicleCategoryController::destroy`.
 */
class UpdateVehicleCategoryRequest extends FormRequest
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
            /**
             * `prohibited`, not merely omitted.
             *
             * Leaving it out of the list is already enough to keep it out of
             * `validated()` and so out of the column — but a request asking
             * to rename a key would then be answered **200 "Category
             * updated."**, and the office would be told a rename happened
             * that did not. Refusing at the door is the honest answer to a
             * request the platform will never carry out.
             */
            'key' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:80'],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:9999'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'key.prohibited' => 'A category key is set once and never changes, because rate '.
                'card prices and issued invoice lines store it. Change the name instead.',
        ];
    }
}
