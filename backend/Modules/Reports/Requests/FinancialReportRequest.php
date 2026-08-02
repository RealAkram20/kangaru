<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Reports\Enums\FinancialPeriod;

/**
 * Filters for the financial report.
 *
 * Its own request rather than a shared one, for the same reason
 * FleetReportRequest is not TripReportRequest: this report accepts
 * `group_by`, which neither of the others can honour, and none of them
 * accept `vehicle_id`, `driver_id` or `status`, which this one cannot.
 * A shared whitelist would have to be the union of all of them, and every
 * report would then silently ignore the filters that are not its own —
 * exactly the silence AGENTS.md's whitelist rule exists to prevent.
 */
class FinancialReportRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['from', 'to', 'group_by'];

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
            'group_by' => ['sometimes', Rule::enum(FinancialPeriod::class)],
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
     * A bare `to` date covers the whole of that day, matching every other
     * report. On this one it is the difference between a month's invoicing
     * and a month's invoicing minus its last day — and month-end is when
     * invoices are raised, so a truncated bound would drop the busiest day
     * in the range.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->query('to');

        return array_filter([
            'from' => $this->query('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            'group_by' => $this->query('group_by'),
        ], fn ($value) => $value !== null && $value !== '');
    }
}
