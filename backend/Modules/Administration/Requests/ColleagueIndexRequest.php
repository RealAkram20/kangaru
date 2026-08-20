<?php

namespace Modules\Administration\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The colleague lookup's one filter, whitelisted like every other listing
 * in the platform — an unknown filter is a 422, never a silent ignore.
 *
 * `q` is **required**, and that is a rule rather than an oversight: without
 * it this endpoint is "hand me the first fifteen names in the directory",
 * which is a staff list by another name.
 */
class ColleagueIndexRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['q'];

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
            // Two characters, so a stray keystroke does not sweep the
            // directory. The client debounces; this is what enforces it.
            'q' => ['required', 'string', 'min:2', 'max:120'],
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
