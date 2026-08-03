<?php

namespace Modules\Reports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\FinancialPeriod;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Requests\Concerns\AcceptsTenantFilter;
use Modules\Trips\Enums\TripStatus;

/**
 * Filters arrive in the POST body here rather than the query string,
 * because requesting an export creates a resource. They are validated
 * against the same whitelist the report itself uses — a filter the report
 * would reject must not be smuggled in through an export.
 */
class RequestExportRequest extends FormRequest
{
    use AcceptsTenantFilter;

    /**
     * The filters each report accepts beyond `from` and `to`, which all of
     * them take.
     *
     * This mirrors the per-report request classes — TripReportRequest,
     * FleetReportRequest and FinancialReportRequest — and exists because
     * this one endpoint stands in for all of them. Without it the rules
     * below are the union of every report's filters, so asking for a
     * driver export filtered to one vehicle was accepted and then ignored:
     * a file reporting every driver while its request said otherwise.
     * That was true before the financial report and is fixed here.
     *
     * @var array<string, array<int, string>>
     */
    private const REPORT_FILTERS = [
        ReportType::TRIPS->value => ['vehicle_id', 'driver_id', 'status'],
        ReportType::DRIVERS->value => [],
        ReportType::VEHICLES->value => [],
        ReportType::FINANCIAL->value => ['group_by'],
    ];

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
            'group_by' => ['nullable', Rule::enum(FinancialPeriod::class)],
            ...$this->tenantFilterRules(),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->input('to')) < strtotime((string) $this->input('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }

            $report = $this->reportType();
            $accepted = self::REPORT_FILTERS[$report->value];

            foreach (array_merge(...array_values(self::REPORT_FILTERS)) as $key) {
                if ($this->filled($key) && ! in_array($key, $accepted, true)) {
                    $validator->errors()->add(
                        $key,
                        "\"{$key}\" is not a filter the {$report->label()} accepts.",
                    );
                }
            }

            // ADR-0007, both directions. `tenant_id` is not in
            // REPORT_FILTERS above because whether it is accepted depends on
            // who is asking as well as which report — the loop's condition
            // is per-report only, and a filter that decides whose money a
            // file contains needs the actor in the question.
            $this->validateTenantFilterAccepted($validator);
            $this->validateTenantFilterRequired($validator);
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

    /**
     * Reads the raw input rather than validated(), because withValidator()
     * needs this while validation is still running — validated() throws if
     * anything has already failed.
     */
    public function reportType(): ReportType
    {
        $requested = $this->input('report');

        return (is_string($requested) ? ReportType::tryFrom($requested) : null) ?? ReportType::TRIPS;
    }

    /**
     * A bare `to` date covers the whole of that day, matching
     * TripReportRequest — the two must agree or an export would not match
     * the report it was taken from.
     *
     * Only the filters the chosen report accepts survive. Validation has
     * already refused the others, so this is belt and braces — but it is
     * also what gets persisted to `report_exports.filters`, and that row is
     * the audit record of what was asked for. A filter recorded there that
     * had no effect on the file would be a lie in the audit trail.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->input('to');
        $accepted = self::REPORT_FILTERS[$this->reportType()->value];

        $optional = array_intersect_key(
            [
                'vehicle_id' => $this->input('vehicle_id'),
                'driver_id' => $this->input('driver_id'),
                'status' => $this->input('status'),
                'group_by' => $this->input('group_by'),
            ],
            array_flip($accepted),
        );

        return array_filter([
            'from' => $this->input('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            ...$optional,
        ], fn ($value) => $value !== null && $value !== '');
    }
}
