<?php

namespace Modules\Billing\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Enums\RateCardStatus;

/**
 * AGENTS.md Integrity: "Invoice generation and payment recording are
 * idempotent: every mutation carries an idempotency key."
 *
 * "Carries" is taken at face value — the key is required, and there is no
 * server-side default. A key the server invents (the trip id, say) makes
 * every retry look identical and is therefore not idempotency at all: it
 * cannot distinguish "the network dropped my response, send it again" from
 * "bill this trip a second time", which are the two cases the mechanism
 * exists to tell apart.
 *
 * Read from the conventional `Idempotency-Key` header, with a body field
 * accepted as a fallback for clients that cannot set headers.
 */
class GenerateInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Folds the header into the validated payload so one rule set covers
     * both ways of supplying it and the failure is a normal 422.
     */
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
        return [
            'idempotency_key' => ['required', 'string', 'min:8', 'max:128'],
            // Optional: without it the tenant's default card is used.
            // Constrained to the caller's own tenant and to active cards —
            // an archived card must not price a new invoice, and a rate card
            // id from another tenant must not resolve at all (ADR-0001).
            'rate_card_id' => [
                'nullable',
                'integer',
                Rule::exists('rate_cards', 'id')->where(
                    fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())
                        ->where('status', RateCardStatus::ACTIVE->value)
                        ->whereNull('deleted_at')
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
                'cannot bill this trip twice.',
        ];
    }

    public function idempotencyKey(): string
    {
        return (string) $this->validated('idempotency_key');
    }
}
