<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;

/**
 * Filters on the availability calendar (ADR-0017).
 *
 * Whitelisted rather than free-form, per AGENTS.md: an unknown filter
 * answers 422 instead of being ignored, because a caller that misspells
 * `resource_type` and is silently shown the whole fleet has been given a
 * wrong answer rather than an error.
 */
class AvailabilityBlockIndexRequest extends FormRequest
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
            'resource_type' => ['sometimes', Rule::enum(AvailabilityResource::class)],
            'resource_id' => ['sometimes', 'integer', 'min:1'],
            'status' => ['sometimes', Rule::enum(AvailabilityStatus::class)],
            // Both or neither: a window with one end is not a window, and
            // guessing the other end would quietly change what was asked.
            //
            // `nullable` rather than `sometimes`, which was the first
            // spelling and silently did nothing: `sometimes` skips the whole
            // rule set when the field is absent, so `required_with` — whose
            // entire job is to fire on absence — was never evaluated and
            // `?from=` alone returned the unfiltered list.
            'from' => ['nullable', 'required_with:to', 'date'],
            'to' => ['nullable', 'required_with:from', 'date', 'after:from'],
        ];
    }
}
