<?php

namespace Modules\Fleet\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;

/**
 * Taking a driver or a vehicle off the road for a period (ADR-0017).
 */
class StoreAvailabilityBlockRequest extends FormRequest
{
    public function authorize(): bool
    {
        // AvailabilityBlockPolicy::createFor, applied in the controller —
        // it needs the resource kind, which is a body field, so it cannot
        // be a route-model-bound policy check.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'resource_type' => ['required', Rule::enum(AvailabilityResource::class)],
            'resource_id' => ['required', 'integer', 'min:1'],
            'kind' => ['required', Rule::enum(AvailabilityKind::class)],
            'starts_at' => ['required', 'date'],
            // Optional, and null means open-ended rather than "forgot to
            // fill it in" — see the migration. `after` rather than
            // `after_or_equal`: a block that starts and ends at the same
            // instant covers nothing, and recording one is always a mistake.
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            'reason' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $resource = AvailabilityResource::from((string) $this->input('resource_type'));
            $id = (int) $this->input('resource_id');

            // A block against an id that names nothing is an unavailability
            // nobody can see, blocking nothing, forever. Checked here rather
            // than with `exists:` because the table depends on the type.
            if (! $resource->exists($id)) {
                $validator->errors()->add(
                    'resource_id',
                    "No {$resource->value} with that id exists.",
                );

                return;
            }

            // Kinds are per resource: a driver does not go in for an
            // inspection and a van does not take annual leave. Allowing the
            // cross product would make the utilisation report the kind
            // exists to feed unreadable.
            $kind = AvailabilityKind::from((string) $this->input('kind'));

            if (! in_array($kind, AvailabilityKind::forResource($resource), true)) {
                $validator->errors()->add(
                    'kind',
                    sprintf(
                        'A %s cannot be blocked for "%s". Use one of: %s.',
                        $resource->value,
                        $kind->value,
                        implode(', ', AvailabilityKind::valuesForResource($resource)),
                    ),
                );
            }
        });
    }
}
