<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Modules\Fleet\Models\VehicleAllocation;

/**
 * Ending a contract on a given day, inclusive.
 *
 * Deliberately not a general update. An allocation is a commercial record
 * and the audit log is a product feature (AGENTS.md Observability): moving
 * a contract's *start* after the fact would rewrite which days a client was
 * owed a vehicle, and the trips dispatched under it would no longer be
 * explicable. Ending one is the only change the business actually makes, so
 * it is the only change the API offers — corrections to anything else mean
 * ending this contract and agreeing another, which leaves both visible.
 */
class EndVehicleAllocationRequest extends FormRequest
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
        // `route()` is typed `object|string|null`, so the model is narrowed
        // rather than assumed. When the binding has not resolved there is no
        // start date to compare against and the rule is simply absent — the
        // route itself 404s before this matters.
        $allocation = $this->route('allocation');

        return [
            // No `after:today`. Recording that a contract ended last Friday
            // is ordinary back-office work, and refusing it would push the
            // correction into the database console where nothing audits it.
            'ends_on' => [
                'required',
                'date',
                ...($allocation instanceof VehicleAllocation
                    ? ['after_or_equal:'.$allocation->starts_on->toDateString()]
                    : []),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'ends_on.after_or_equal' => 'A contract cannot end before the day it started.',
        ];
    }
}
