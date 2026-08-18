<?php

namespace Modules\Fleet\Services;

use Illuminate\Support\Collection;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\Zone;

/**
 * Which zones a place falls in (ADR-0021).
 *
 * The one place a point becomes a set of zones. Billing will ask it for a
 * pricing zone, dispatch for eligibility, and ordering for whether the
 * pickup is anywhere the platform operates — and all three must get the
 * same answer for the same point, which is why they all come here.
 *
 * ## Cached, because the shapes barely change
 *
 * Zones are edited by an operations manager occasionally and read on every
 * booking. The active set is cached and busted on write, so resolution is
 * a handful of in-memory ring tests rather than a query per booking. The
 * key carries the tenant, per ADR-0001's cache-prefixing rule.
 */
class ZoneResolver
{
    /**
     * Every zone containing the point, most specific first.
     *
     * @return Collection<int, Zone>
     */
    public function at(float $lat, float $lng, ?int $tenantId = null): Collection
    {
        return $this->candidates($tenantId)
            ->filter(fn (Zone $zone) => $zone->contains($lat, $lng))
            // Lower priority wins: a client zone (10) sits inside a town
            // (50) inside the service area (90), and the caller wants the
            // narrowest answer first.
            ->sortBy(fn (Zone $zone) => $zone->priority)
            ->values();
    }

    /**
     * The zone a trip from here should be priced in, or null when no
     * pricing zone covers it.
     *
     * Null is a real answer, not a failure: `invoice_lines.zone` is
     * nullable precisely so that an invoice raised outside every priced
     * zone is unambiguously "no zone applied" rather than "we forgot"
     * (`Modules/Billing/README.md`).
     */
    public function pricingZoneAt(float $lat, float $lng, ?int $tenantId = null): ?Zone
    {
        return $this->at($lat, $lng, $tenantId)
            ->first(fn (Zone $zone) => in_array($zone->kind, [ZoneKind::PRICING, ZoneKind::CLIENT], true));
    }

    /**
     * Whether the platform operates anywhere near this point.
     *
     * **True when no service area has been drawn at all.** That is the
     * whole safety of the feature: an operator who has not yet mapped their
     * coverage must not have every order refused, and a validation rule
     * that silently switches on the day somebody saves their first zone
     * would be worse than none. Coverage is opt-in, per zone, exactly like
     * ADR-0017's rosters.
     */
    public function withinServiceArea(float $lat, float $lng): bool
    {
        $areas = $this->candidates(null)
            ->filter(fn (Zone $zone) => $zone->kind === ZoneKind::SERVICE_AREA);

        if ($areas->isEmpty()) {
            return true;
        }

        return $areas->contains(fn (Zone $zone) => $zone->contains($lat, $lng));
    }

    /**
     * @return Collection<int, Zone>
     */
    private function candidates(?int $tenantId): Collection
    {
        return Zone::query()
            ->where('active', true)
            ->visibleTo($tenantId)
            ->get();
    }
}
