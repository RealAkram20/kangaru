<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Customers\Enums\CustomerStatus;

/**
 * Filters on the customer register (ADR-0018 §2).
 *
 * Whitelisted, per AGENTS.md: an unknown filter answers 422 rather than
 * being ignored. A dispatcher who mistypes a parameter and is silently
 * shown the whole register has been given a wrong answer, not an error.
 */
class CustomerIndexRequest extends FormRequest
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
            // Name, email or phone. Two characters minimum: a single letter
            // matches most of the register and costs a full scan to say so.
            'q' => ['sometimes', 'string', 'min:2', 'max:100'],
            'status' => ['sometimes', Rule::enum(CustomerStatus::class)],
            'cursor' => ['sometimes', 'string'],
        ];
    }
}
