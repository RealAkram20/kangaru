<?php

namespace Modules\Billing\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Billing\Models\RateCard;

/**
 * Renames a rate card, redescribes it, or archives it.
 *
 * ## What this deliberately cannot touch
 *
 * **No prices, and no version.** `PricedRate` throws
 * `FinancialRecordImmutableException` on update and this request offers no
 * field that would reach one. Changing what a client is charged is
 * `storeVersion` and only ever `storeVersion` — PRODUCT.md's positioning is
 * that *"every invoice is fully reproducible from stored data (versioned
 * immutable rate cards)"*, and an editable price silently restates invoices
 * already sent.
 *
 * **Not `is_default` either.** That has its own endpoint
 * (`PUT /rate-cards/{card}/default`) because promoting a card is a different
 * act with a different consequence — it must demote whichever card currently
 * holds the flag, in one transaction, and `RateCardService::makeDefault()`
 * owns that. A `is_default: true` accepted here would be a second way to do
 * it, and the second way is the one that forgets to demote.
 *
 * So what is left is exactly the three fields that are *labels on* a pricing
 * document rather than *terms of* one. That is the whole scope, and it is
 * what makes this safe to add to a module whose central rule is immutability.
 *
 * ## Why it was worth adding at all
 *
 * There was no way to change any of them. A typo in a card's name was
 * permanent, and a card that had been superseded could not be taken out of
 * the way — `archived` existed in the enum with nothing able to set it.
 */
class UpdateRateCardRequest extends FormRequest
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
        /** @var RateCard $card */
        $card = $this->route('rateCard');

        return [
            // `sometimes` throughout: this is a PATCH, and a client sending
            // only `status` must not have the other two validated as though
            // they had been cleared.
            'name' => [
                'sometimes',
                'required',
                'string',
                'max:100',
                // **Scoped to the card's own tenant, and ignoring itself.**
                // Not `TenantContext` like `StoreRateCardRequest` does — that
                // is right on create, where the card's owner is the actor's
                // tenant, and wrong here: platform staff editing a
                // tenant-owned card bind no tenant, so the uniqueness check
                // would compare against `tenant_id IS NULL` and let a
                // duplicate through. The card in hand already knows whose it
                // is.
                Rule::unique('rate_cards')
                    ->ignore($card->getKey())
                    ->where(fn ($query) => $query->where('tenant_id', $card->tenant_id)),
            ],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'status' => ['sometimes', 'required', Rule::enum(RateCardStatus::class)],
        ];
    }

    /**
     * Only the keys actually sent, so a PATCH omitting a field leaves it
     * alone rather than nulling it.
     *
     * @return array<string, mixed>
     */
    public function cardDetails(): array
    {
        return $this->safe()->only(['name', 'description', 'status']);
    }
}
