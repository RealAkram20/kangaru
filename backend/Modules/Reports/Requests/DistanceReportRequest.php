<?php

namespace Modules\Reports\Requests;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Reports\Support\ReportScope;
use Modules\Trips\Distance\DistanceGrade;

/**
 * Filters for the measured-distance report (ADR-0045).
 *
 * ## Why this is not a `ReportType`
 *
 * `ReportType` is the seam for reports that are *exported*: it names the
 * export source, the filename slug, the row noun and the tenant-filter rule
 * in one place so the on-screen request, the export request, the scope
 * resolver and the response cannot disagree. This report is not exportable —
 * it is the operator's instrument for judging whether the trace can be
 * trusted with the fare, read on a screen while shadow data accumulates —
 * so it takes the same tenant-filter rule as the trip report (**optional**
 * for platform staff, refused for a client's user, ADR-0007) directly,
 * rather than adding a case that four other places would have to answer
 * for a report that never becomes a file. If it ever does, it becomes a
 * `ReportType` then, and this class shrinks to the trait.
 */
class DistanceReportRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['from', 'to', 'grade', 'provider', 'cursor'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $rules = [
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date'],
            'grade' => ['sometimes', Rule::enum(DistanceGrade::class)],
            'provider' => ['sometimes', Rule::in(['osrm', 'haversine'])],
            'cursor' => ['sometimes', 'string'],
        ];

        if ($this->actor()->isPlatformLevel()) {
            $rules['tenant_id'] = ['sometimes', 'integer', Rule::exists('tenants', 'id')];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            // Unknown filters return 422, not silence (AGENTS.md). For a
            // client's user `tenant_id` is unknown too, which is the right
            // answer: the parameter does not exist for them.
            $allowed = $this->actor()->isPlatformLevel()
                ? [...self::ALLOWED_KEYS, 'tenant_id']
                : self::ALLOWED_KEYS;

            foreach (array_diff(array_keys($this->query()), $allowed) as $key) {
                $validator->errors()->add($key, 'This filter is not recognized.');
            }

            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->query('to')) < strtotime((string) $this->query('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->query('to');

        return array_filter([
            'from' => $this->query('from'),
            // A bare date as the end of a range means the whole of that day.
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            'grade' => $this->query('grade'),
            'provider' => $this->query('provider'),
        ], fn ($value) => $value !== null && $value !== '');
    }

    public function reportScope(): ReportScope
    {
        $actor = $this->actor();

        if (! $actor->isPlatformLevel()) {
            // Never `?? tenant_id` from the query: a client's user may not
            // name a tenant, and honouring one here would be a cross-tenant
            // read one bypassed validation away.
            return ReportScope::tenant((int) $actor->tenant_id);
        }

        $requested = $this->query('tenant_id');

        return is_numeric($requested) ? ReportScope::tenant((int) $requested) : ReportScope::allClients();
    }

    private function actor(): User
    {
        $user = $this->user();

        abort_unless($user instanceof User, 401);

        return $user;
    }
}
