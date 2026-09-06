<?php

namespace Modules\Trips\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The distance review queue takes no filters (ADR-0045 §2).
 *
 * It is a worklist, not a report: everything in it is waiting on the same
 * decision, and the only ordering that matters is the one the SLA is measured
 * on. Narrowing it by grade or client would be a way of not seeing part of
 * the backlog, and `GET /reports/distance` already exists for looking at
 * resolutions any way you like.
 *
 * So the whitelist is a cursor and nothing else — and anything else is a 422
 * rather than a silent ignore (AGENTS.md), which is what stops a client
 * believing they filtered a queue they did not.
 */
class HeldTripIndexRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['cursor'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['cursor' => ['sometimes', 'string']];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_diff(array_keys($this->query()), self::ALLOWED_KEYS) as $key) {
                $validator->errors()->add($key, 'This queue takes no filters. Use the measured-distance report to look at resolutions.');
            }
        });
    }
}
