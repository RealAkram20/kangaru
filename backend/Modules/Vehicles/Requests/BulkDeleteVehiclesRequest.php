<?php

namespace Modules\Vehicles\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The vehicles a fleet asked to retire in one action.
 *
 * ## Why a ceiling, and why it is small
 *
 * A hundred. Not because the database would struggle — it would not — but
 * because this is the one request in the module that removes rows, and the
 * size of the mistake it can make is the size of this number. A fleet retires
 * a handful of vans when it sells them; a request naming a thousand ids is
 * either a bug in a client or somebody's whole register, and neither should be
 * honoured because the array happened to arrive.
 *
 * The screen selects within one page of the table, so it cannot reach this in
 * ordinary use. It is here for the request that did not come from the screen.
 *
 * ## `distinct`, because the count is a promise
 *
 * The confirmation the admin reads says "Delete 6 vehicles". If the same id
 * arrived twice the batch would report six and touch five, and the one number
 * on a destructive dialog would be wrong. Rejected rather than silently
 * de-duplicated: a client sending duplicates has a bug worth surfacing.
 *
 * Existence is **not** checked here. A missing id is a refusal with a reason
 * the admin can read, alongside the vehicle that is out on a job — one report,
 * one shape, rather than a validation error for one kind of unknown id and a
 * business refusal for another.
 */
class BulkDeleteVehiclesRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['integer', 'distinct'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'ids.max' => 'Too many vehicles at once. Select up to 100.',
            'ids.required' => 'Choose at least one vehicle to delete.',
        ];
    }

    /**
     * @return array<int, int>
     */
    public function ids(): array
    {
        /** @var array<int, int> $ids */
        $ids = $this->validated()['ids'];

        return $ids;
    }
}
