<?php

namespace Modules\Administration\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AuditLogIndexRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['auditable_type', 'action', 'cursor'];

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
            'auditable_type' => ['sometimes', 'string', Rule::in(['company', 'user'])],
            'action' => ['sometimes', 'string', Rule::in(['created', 'updated', 'deleted'])],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $unknown = array_diff(array_keys($this->query()), self::ALLOWED_KEYS);

            foreach ($unknown as $key) {
                $validator->errors()->add($key, 'This filter is not recognized.');
            }
        });
    }
}
