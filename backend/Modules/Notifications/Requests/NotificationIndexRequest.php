<?php

namespace Modules\Notifications\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Filters for a user's own inbox.
 *
 * Whitelisted like every other list in the platform: an unknown filter is a
 * 422, never a silent ignore (AGENTS.md, API Standards).
 */
class NotificationIndexRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['unread', 'limit'];

    /** The bell panel shows a handful; the ceiling stops a client asking for everything. */
    private const DEFAULT_LIMIT = 20;

    private const MAX_LIMIT = 100;

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
            'unread' => ['sometimes', 'boolean'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_LIMIT],
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

    public function unreadOnly(): bool
    {
        return $this->boolean('unread');
    }

    public function limit(): int
    {
        $limit = $this->query('limit');

        return is_numeric($limit)
            ? min((int) $limit, self::MAX_LIMIT)
            : self::DEFAULT_LIMIT;
    }
}
