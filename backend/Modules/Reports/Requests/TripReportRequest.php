<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Requests\Concerns\AcceptsTenantFilter;
use Modules\Trips\Enums\TripStatus;

class TripReportRequest extends FormRequest
{
    use AcceptsTenantFilter;

    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     *
     * `tenant_id` joins this list only for platform staff (ADR-0007), which
     * is why the whitelist is a method rather than the constant it used to
     * be.
     */
    private const ALLOWED_KEYS = ['from', 'to', 'vehicle_id', 'driver_id', 'status', 'cursor'];

    public function authorize(): bool
    {
        return true;
    }

    public function reportType(): ReportType
    {
        return ReportType::TRIPS;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date'],
            'vehicle_id' => ['sometimes', 'integer'],
            'driver_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(TripStatus::class)],
            'cursor' => ['sometimes', 'string'],
            ...$this->tenantFilterRules(),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $allowed = [...self::ALLOWED_KEYS, ...$this->tenantFilterKeys()];

            foreach (array_diff(array_keys($this->query()), $allowed) as $key) {
                $validator->errors()->add($key, 'This filter is not recognized.');
            }

            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->query('to')) < strtotime((string) $this->query('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }

            $this->validateTenantFilterRequired($validator);
        });
    }

    /**
     * `to` is inclusive of the whole day when given as a bare date —
     * "1st to 31st" must include the 31st, not stop at its first second.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->query('to');

        return array_filter([
            'from' => $this->query('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            'vehicle_id' => $this->query('vehicle_id'),
            'driver_id' => $this->query('driver_id'),
            'status' => $this->query('status'),
        ], fn ($value) => $value !== null && $value !== '');
    }
}
