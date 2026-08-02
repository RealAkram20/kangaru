<?php

namespace Modules\Administration\Requests;

use App\Enums\UserStatus;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the staff list. Whitelisted like every other listing in the
 * platform — an unknown filter is a 422, never a silent ignore.
 */
class UserIndexRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['status', 'role', 'q'];

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
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
            'q' => ['sometimes', 'string', 'max:120'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_diff(array_keys($this->query()), self::ALLOWED_KEYS) as $key) {
                $validator->errors()->add((string) $key, "\"{$key}\" is not a filter this endpoint accepts.");
            }
        });
    }
}
