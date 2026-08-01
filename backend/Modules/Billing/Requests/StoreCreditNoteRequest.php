<?php

namespace Modules\Billing\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Models\Invoice;

/**
 * A credit note is the only way to change what a client owes, so the two
 * things an auditor will ask about it are mandatory here: a stated reason,
 * and at least one line saying what is being credited.
 *
 * Whether the amount is *within* the invoice is deliberately not checked
 * here. That depends on every other credit note against the same invoice
 * and is only trustworthy under the invoice's row lock, so CreditNoteService
 * answers it — and returns 422 CREDIT_NOTE_EXCEEDS_INVOICE, not a
 * validation error that could be stale by the time it is rendered.
 */
class StoreCreditNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $header = $this->header('Idempotency-Key');

        if (is_string($header) && $header !== '') {
            $this->merge(['idempotency_key' => $header]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // The route parameter is only an Invoice once model binding has
        // resolved it; typed explicitly so the scoping below cannot
        // silently compare against nothing.
        $invoice = $this->route('invoice');
        $invoiceId = $invoice instanceof Invoice ? $invoice->id : null;

        return [
            'idempotency_key' => ['required', 'string', 'min:8', 'max:128'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],

            'lines' => ['required', 'array', 'min:1'],
            'lines.*.description' => ['required', 'string', 'max:255'],
            // Strictly positive: a zero line credits nothing and a negative
            // one would be an extra charge wearing a credit note's clothes.
            'lines.*.amount_minor' => ['required', 'integer', 'min:1'],
            // Optional attribution. Scoped to this invoice and this tenant,
            // so a line id from another invoice — or another client's —
            // cannot be attached (ADR-0001: cross-tenant ids must not
            // resolve).
            'lines.*.invoice_line_id' => [
                'nullable',
                'integer',
                Rule::exists('invoice_lines', 'id')->where(
                    fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())
                        ->where('invoice_id', $invoiceId)
                ),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'idempotency_key.required' => 'An Idempotency-Key header is required so that a retried request '.
                'cannot credit this invoice twice.',
            'lines.*.invoice_line_id.exists' => 'That invoice line does not belong to this invoice.',
        ];
    }

    public function idempotencyKey(): string
    {
        return (string) $this->validated('idempotency_key');
    }

    /**
     * @return array<int, array{description: string, amount_minor: int, invoice_line_id?: int|null}>
     */
    public function lines(): array
    {
        /** @var array<int, array<string, mixed>> $lines */
        $lines = $this->validated('lines');

        return array_map(fn (array $line) => [
            'description' => (string) $line['description'],
            'amount_minor' => (int) $line['amount_minor'],
            'invoice_line_id' => isset($line['invoice_line_id']) ? (int) $line['invoice_line_id'] : null,
        ], array_values($lines));
    }
}
