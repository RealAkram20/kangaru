<?php

namespace Modules\Billing\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * AGENTS.md API Standards: "Filtering via whitelisted query params per
 * endpoint; unknown filters return 422, not silence." An unknown filter
 * that is silently ignored returns a wider result set than the caller
 * asked for, which on an invoice list is a number somebody will act on.
 */
class InvoiceIndexRequest extends FormRequest
{
    private const ALLOWED = ['from', 'to', 'trip_id', 'invoice_number', 'cursor'];

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
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'trip_id' => ['nullable', 'integer'],
            'invoice_number' => ['nullable', 'string', 'max:50'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $unknown = array_diff(array_keys($this->query()), self::ALLOWED);

            foreach ($unknown as $key) {
                $validator->errors()->add((string) $key, "\"{$key}\" is not a filter this endpoint accepts.");
            }

            if ($this->filled('from') && $this->filled('to')
                && strtotime((string) $this->input('to')) < strtotime((string) $this->input('from'))) {
                $validator->errors()->add('to', 'The end of the range cannot fall before its start.');
            }
        });
    }

    /**
     * A bare `to` date covers the whole of that day — the same convention
     * the trip report uses, so the two agree about what "to 31 July" means.
     *
     * @return array<string, mixed>
     */
    public function filters(): array
    {
        $to = $this->input('to');

        return array_filter([
            'from' => $this->input('from'),
            'to' => is_string($to) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to.' 23:59:59' : $to,
            'trip_id' => $this->input('trip_id'),
            'invoice_number' => $this->input('invoice_number'),
        ], fn ($value) => $value !== null && $value !== '');
    }
}
