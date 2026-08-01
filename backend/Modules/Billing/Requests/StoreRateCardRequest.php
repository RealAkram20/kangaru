<?php

namespace Modules\Billing\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Models\RateCardVersion;

/**
 * Creates a rate card together with its first priced version.
 *
 * The two are inseparable by design: a card with no version prices nothing,
 * and a tenant whose default card prices nothing produces a
 * RATE_CARD_NOT_CONFIGURED on the first trip somebody tries to bill. Making
 * the version part of creation means that state cannot be reached through
 * the API at all.
 */
class StoreRateCardRequest extends FormRequest
{
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
            'name' => [
                'required',
                'string',
                'max:100',
                Rule::unique('rate_cards')->where(
                    fn ($query) => $query->where('tenant_id', app(TenantContext::class)->get())
                ),
            ],
            'description' => ['nullable', 'string', 'max:1000'],
            'is_default' => ['nullable', 'boolean'],
            'version' => ['required', 'array'],
            ...StoreRateCardVersionRequest::versionRules('version.'),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $v) => StoreRateCardVersionRequest::validateRates(
            $v,
            $this->input('version.rates', []),
            'version.rates',
        ));
    }

    /**
     * @return array<string, mixed>
     */
    public function cardData(): array
    {
        /** @var array<string, mixed> $version */
        $version = $this->validated('version');

        return [
            'name' => $this->validated('name'),
            'description' => $this->validated('description'),
            'is_default' => (bool) $this->validated('is_default'),
            'version' => [
                'effective_from' => $version['effective_from'],
                'rounding_mode' => $version['rounding_mode'] ?? null,
                'free_waiting_minutes' => $version['free_waiting_minutes'] ?? 0,
                'night_starts_at' => $version['night_starts_at'] ?? null,
                'night_ends_at' => $version['night_ends_at'] ?? null,
                'night_multiplier_bp' => $version['night_multiplier_bp'] ?? RateCardVersion::NO_MULTIPLIER_BP,
                'notes' => $version['notes'] ?? null,
                'rates' => $version['rates'],
            ],
        ];
    }
}
