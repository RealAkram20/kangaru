<?php

namespace Modules\Trips\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * AGENTS.md API Standards: "Filtering via whitelisted query params per
 * endpoint; unknown filters return 422, not silence."
 */
class TripRouteRequest extends FormRequest
{
    private const ALLOWED = ['per_page', 'cursor'];

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
            'per_page' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_diff(array_keys($this->query()), self::ALLOWED) as $key) {
                $validator->errors()->add((string) $key, "\"{$key}\" is not a parameter this endpoint accepts.");
            }
        });
    }

    /**
     * 500 by default: enough that a short town trip comes back in one page,
     * small enough that a page stays a reasonable response.
     */
    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? 500);
    }
}
