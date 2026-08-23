<?php

namespace Modules\Trips\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Why a held distance is being cleared (ADR-0045 §2). Required and long
 * enough to say something: a clearance is an audited overrule of the
 * evidence, and "ok" is not a reason a bank's auditor accepts.
 */
class ClearTripDistanceRequest extends FormRequest
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
            'reason' => ['required', 'string', 'min:10', 'max:500'],
        ];
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }
}
