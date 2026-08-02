<?php

namespace Modules\Administration\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AuditLogIndexRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['auditable_type', 'action', 'user_id', 'from', 'to', 'cursor'];

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
            // Derived from the enforced morph map rather than listed here.
            // The hardcoded list said `company|user` and had not moved since
            // it was written, so filtering for a role change — the audit
            // AGENTS.md names first — answered 422 for a type the table was
            // full of. A list that must be remembered is a list that goes
            // stale; this one cannot.
            'auditable_type' => ['sometimes', 'string', Rule::in(self::auditableTypes())],
            'action' => ['sometimes', 'string', Rule::in(self::ACTIONS)],
            // Who did it. Not validated against `users` existing: an actor
            // may have been an account that has since been anonymised under
            // the retention policy, and the trail must outlive them.
            'user_id' => ['sometimes', 'integer', 'min:1'],
            // Dates, not datetimes. "Every credit-limit change in March" is
            // the question this endpoint exists to answer, and nobody asks
            // it to the second.
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'to.after_or_equal' => 'The end of the range cannot fall before its start.',
            'from.date_format' => 'Dates are YYYY-MM-DD, e.g. 2026-03-01.',
            'to.date_format' => 'Dates are YYYY-MM-DD, e.g. 2026-03-31.',
        ];
    }

    /** The actions `App\Concerns\Auditable` records. */
    public const ACTIONS = ['created', 'updated', 'deleted'];

    /**
     * Every alias an `auditable_type` can hold, sorted for a stable order.
     *
     * @return array<int, string>
     */
    public static function auditableTypes(): array
    {
        $types = array_keys(Relation::morphMap());
        sort($types);

        return $types;
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
