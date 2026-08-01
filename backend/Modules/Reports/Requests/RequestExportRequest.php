<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ReportType;
use Modules\Trips\Enums\TripStatus;

/**
 * Filters arrive in the POST body here rather than the query string,
 * because requesting an export creates a resource. They are validated
 * against the same whitelist the report itself uses — a filter the report
 * would reject must not be smuggled in through an export.
 */
class RequestExportRequest extends FormRequest
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
            'format' => ['required', Rule::enum(ExportFormat::class)],
            // Optional and defaulting to trips: this endpoint existed
            // before there was more than one report, and AGENTS.md's API
            // rule allows adding an optional field but not making an
            // existing call fail.
            'report' => ['nullable', Rule::enum(ReportType::class)],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'vehicle_id' => ['nullable', 'integer'],
            'driver_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::enum(TripStatus::class)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->input('to')) < strtotime((string) $this->input('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }
        });
    }

    /**
     * Not named `format()` — that is already `Illuminate\Http\Request::format($default)`
     * and overriding it with an incompatible signature is a fatal error.
     */
    public function exportFormat(): ExportFormat
    {
        return ExportFormat::from($this->validated('format'));
    }

    public function reportType(): ReportType
    {
        return ReportType::tryFrom((string) $this->validated('report')) ?? ReportType::TRIPS;
    }

    /**
     * A bare `to` date covers the whole of that day, matching
     * TripReportRequest — the two must agree or an export would not match
     * the report it was taken from.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->input('to');

        return array_filter([
            'from' => $this->input('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            'vehicle_id' => $this->input('vehicle_id'),
            'driver_id' => $this->input('driver_id'),
            'status' => $this->input('status'),
        ], fn ($value) => $value !== null && $value !== '');
    }
}
