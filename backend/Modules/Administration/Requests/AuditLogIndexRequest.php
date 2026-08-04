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
    private const ALLOWED_KEYS = [
        'auditable_type', 'auditable_id', 'action', 'user_id', 'q', 'from', 'to', 'cursor',
    ];

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
            // One record's history — "every change to Company #3", which the
            // type filter alone could not ask. Meaningless without the type
            // beside it: ids are per-table, so a bare `auditable_id=3` would
            // mix Company 3 with Vehicle 3. `required_with` states that
            // rather than quietly returning the mixture; see withValidator
            // for the other half of the pairing.
            'auditable_id' => ['sometimes', 'integer', 'min:1'],
            'action' => ['sometimes', 'string', Rule::in(self::ACTIONS)],
            // Free text across the trail, including the recorded diff — the
            // question "who touched the credit limit" cannot be asked with
            // the structured filters, because the field that changed is
            // inside `changes`, not a column.
            'q' => ['sometimes', 'string', 'max:120'],
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
            'auditable_id.integer' => 'A record id is a number.',
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

            // `auditable_id` only means something beside `auditable_type`.
            // Ids are per-table: a bare `auditable_id=3` would return
            // Company 3, Vehicle 3 and User 3 interleaved and call it one
            // record's history. Refusing is the honest answer; silently
            // returning the mixture would be a wrong answer that looks
            // right, which is the failure this whole endpoint exists to
            // prevent.
            if ($this->filled('auditable_id') && ! $this->filled('auditable_type')) {
                $validator->errors()->add(
                    'auditable_id',
                    'Name the record type as well — ids are only unique within one type.',
                );
            }
        });
    }
}
