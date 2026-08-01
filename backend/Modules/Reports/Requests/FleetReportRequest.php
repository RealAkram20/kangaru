<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Filters for the driver and vehicle reports.
 *
 * Deliberately not TripReportRequest, even though the date handling is
 * identical. That request also accepts `vehicle_id`, `driver_id` and
 * `status`, none of which an aggregate grouped by driver or vehicle can
 * honour — reusing it would accept those filters and quietly ignore them,
 * which is exactly the silence AGENTS.md's whitelist rule exists to
 * prevent. A narrower report gets a narrower whitelist.
 */
class FleetReportRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['from', 'to'];

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
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_diff(array_keys($this->query()), self::ALLOWED_KEYS) as $key) {
                $validator->errors()->add((string) $key, "\"{$key}\" is not a filter this report accepts.");
            }

            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->query('to')) < strtotime((string) $this->query('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }
        });
    }

    /**
     * A bare `to` date covers the whole of that day, matching the trip
     * report — the two must agree or the same range would produce
     * different totals depending on which report you opened.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->query('to');

        return array_filter([
            'from' => $this->query('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
        ], fn ($value) => $value !== null && $value !== '');
    }
}
