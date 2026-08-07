<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * "Which zones is this point in?" (ADR-0021) — what a dispatcher asks when
 * a price or a refusal needs explaining.
 */
class ResolveZoneRequest extends FormRequest
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
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ];
    }
}
