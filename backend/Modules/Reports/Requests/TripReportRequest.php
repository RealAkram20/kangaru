<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Trips\Enums\TripStatus;

class TripReportRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['from', 'to', 'vehicle_id', 'driver_id', 'status', 'cursor'];

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
            'vehicle_id' => ['sometimes', 'integer'],
            'driver_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(TripStatus::class)],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_diff(array_keys($this->query()), self::ALLOWED_KEYS) as $key) {
                $validator->errors()->add($key, 'This filter is not recognized.');
            }

            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->query('to')) < strtotime((string) $this->query('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }
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
