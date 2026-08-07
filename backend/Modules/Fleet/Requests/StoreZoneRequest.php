<?php

namespace Modules\Fleet\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Fleet\Enums\ZoneKind;

/**
 * Drawing a geofence (ADR-0021).
 */
class StoreZoneRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'kind' => ['required', Rule::enum(ZoneKind::class)],
            // Only a client zone carries one; the rest are the platform's.
            'tenant_id' => ['nullable', 'integer', 'exists:tenants,id'],
            'priority' => ['sometimes', 'integer', 'between:1,999'],
            'active' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:255'],

            // Three points is the fewest that enclose an area. Fewer is a
            // line, which contains nothing and would silently make every
            // point outside the zone.
            'boundary' => ['required', 'array', 'min:3'],
            // Named keys rather than GeoJSON's positional [lng, lat]: that
            // ordering is the most common coordinate bug there is, and
            // ADR-0020 records this codebase hitting a swap that no range
            // check could catch.
            'boundary.*.lat' => ['required', 'numeric', 'between:-90,90'],
            'boundary.*.lng' => ['required', 'numeric', 'between:-180,180'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $kind = ZoneKind::from((string) $this->input('kind'));
            $tenantId = $this->input('tenant_id');

            // A client zone with no client belongs to nobody and would
            // silently become a platform-wide rule — the opposite of what
            // whoever drew it meant.
            if ($kind->requiresTenant() && $tenantId === null) {
                $validator->errors()->add('tenant_id', 'A client zone has to say which client it belongs to.');
            }

            // And the mirror: a service area or town that names a client
            // would apply to that client alone, which is not what those
            // kinds mean.
            if (! $kind->requiresTenant() && $tenantId !== null) {
                $validator->errors()->add(
                    'tenant_id',
                    sprintf('A %s zone is the platform\'s and cannot belong to one client.', $kind->value),
                );
            }
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null): array
    {
        $validated = parent::validated();
        $validated['priority'] ??= ZoneKind::from($validated['kind'])->defaultPriority();

        return $validated;
    }
}
