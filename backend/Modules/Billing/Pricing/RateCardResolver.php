<?php

namespace Modules\Billing\Pricing;

use Modules\Billing\Enums\RateCardStatus;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardVersion;
use Modules\Trips\Models\Trip;

/**
 * Decides which priced rate card version applies to a trip.
 *
 * The answer must be a function of stored data alone, because an invoice
 * that cannot be re-derived is the dispute AGENTS.md's versioning rule
 * exists to end. So the choice depends only on: the card (named by the
 * caller, or the tenant's default), and the trip's own start date against
 * each version's `effective_from`. Nothing here consults "now".
 *
 * That is what makes back-dated corrections safe: a new version dated
 * before an old trip changes what *that trip* would price at, which is why
 * versions are immutable once used and already-issued invoices keep their
 * own `rate_card_version_id` rather than re-resolving.
 */
class RateCardResolver
{
    /**
     * @throws RateCardNotConfiguredException
     */
    public function resolveFor(Trip $trip, ?RateCard $card = null): RateCardVersion
    {
        $card ??= $this->defaultCardForTenant();

        // `started_at` is the moment the journey commenced — the Bank's
        // first acceptance criterion, and the only date a client would
        // accept as "when this trip happened". Not created_at, which is
        // when a dispatcher happened to key it in.
        $on = ($trip->started_at ?? $trip->created_at)->toDateString();

        $version = $card->versions()
            ->with('rates')
            ->where('effective_from', '<=', $on)
            ->reorder()
            ->orderByDesc('effective_from')
            // Two versions effective the same day is a correction issued
            // and re-issued on one date; the later version wins.
            ->orderByDesc('version')
            ->first();

        if ($version === null) {
            throw RateCardNotConfiguredException::noEffectiveVersion($card->name, $on);
        }

        return $version;
    }

    /**
     * @throws RateCardNotConfiguredException
     */
    private function defaultCardForTenant(): RateCard
    {
        // TenantScope (ADR-0001) restricts this to the caller's tenant, so
        // "the default card" can never resolve to another client's prices.
        // Callers outside a request must have bound TenantContext first.
        $card = RateCard::query()
            ->where('is_default', true)
            ->where('status', RateCardStatus::ACTIVE)
            ->first();

        if ($card === null) {
            throw RateCardNotConfiguredException::noDefaultCard();
        }

        return $card;
    }
}
