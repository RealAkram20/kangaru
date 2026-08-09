<?php

namespace Modules\Billing\Pricing;

use App\Support\Tenancy\TenantScope;
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
        // A walk-in has no tenant, so `defaultCardForTenant()` would resolve
        // through `TenantScope` and find nothing at all — the reason
        // ADR-0024 had to defer pricing. The platform's own tariff is what
        // applies (ADR-0026 §1).
        $card ??= $trip->isWalkIn() ? $this->walkInTariff() : $this->defaultCardForTenant();

        // `started_at` is the moment the journey commenced — the Bank's
        // first acceptance criterion, and the only date a client would
        // accept as "when this trip happened". Not created_at, which is
        // when a dispatcher happened to key it in.
        $on = ($trip->started_at ?? $trip->created_at)->toDateString();

        // A platform card's versions are unreachable through the relation.
        //
        // `rate_card_versions` carries `BelongsToTenant`, and `TenantScope`
        // fails closed — so with no tenant bound, which is a walk-in's
        // permanent condition, `$card->versions()` returns nothing and the
        // tariff looks unpriced. The card resolved; its prices did not.
        //
        // `allTenants()` is the reviewed opt-out, and the `whereNull`
        // beside it is what replaces the scope rather than merely dropping
        // it: this can only ever read the platform's own versions.
        $versions = $card->tenant_id === null
            ? RateCardVersion::allTenants()->whereNull('tenant_id')->where('rate_card_id', $card->id)
            : $card->versions();

        // The eager load has to escape the scope too, and so does every
        // relation under it. `rate_card_rates`, `rate_card_versions` and
        // `rate_cards` all carry `BelongsToTenant`, so on a platform card
        // the version loads, its rates come back empty, and pricing reports
        // the category as unpriced — a tariff that exists and prices
        // nothing.
        //
        // Constraining each relation is what keeps the opt-out narrow: every
        // one of these can still only read rows with no tenant.
        $eager = $card->tenant_id === null
            ? [
                'rates' => fn ($query) => $query->withoutGlobalScope(TenantScope::class)->whereNull('tenant_id'),
                'rates.zoneRates' => fn ($query) => $query->withoutGlobalScope(TenantScope::class),
                'rates.zoneRates.zone' => fn ($query) => $query->withoutGlobalScope(TenantScope::class),
                'rateCard' => fn ($query) => $query->withoutGlobalScope(TenantScope::class)->whereNull('tenant_id'),
            ]
            : ['rates.zoneRates.zone'];

        $version = $versions
            // Down to `zoneRates.zone`, because pricing reads all three:
            // the rates to find the category, the zone rates to find an
            // override, and the zone itself for the name that goes on the
            // issued document. Lazy loading would answer correctly and take
            // a query per rate to do it, on the one path AGENTS.md puts a
            // 90% coverage gate over.
            ->with($eager)
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
     * The platform's public tariff (ADR-0026 §1).
     *
     * A rate card with no tenant, which is the same "belongs to the
     * platform, not a client" spelling `drivers`, `vehicles`,
     * `order_requests` and `trips` all use (ADR-0005).
     *
     * `allTenants()` is required and is the narrow, reviewed exception
     * `BelongsToTenant` describes: `TenantScope` filters
     * `where tenant_id = <bound>`, which never matches NULL, so the tariff
     * is unreachable through the ordinary scope by construction. The
     * `whereNull` immediately after is what replaces the scope it drops —
     * this can only ever return a platform-owned row, never a client's.
     *
     * @throws RateCardNotConfiguredException
     */
    private function walkInTariff(): RateCard
    {
        $card = RateCard::allTenants()
            ->whereNull('tenant_id')
            ->where('is_default', true)
            ->where('status', RateCardStatus::ACTIVE)
            ->first();

        if ($card === null) {
            // Refuses rather than falling back to some client's prices,
            // which would bill a stranger at a bank's negotiated rate — in
            // whichever direction that happened to be wrong.
            throw RateCardNotConfiguredException::noWalkInTariff();
        }

        return $card;
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
