<?php

namespace Modules\Vehicles\Services;

use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Billing\Models\InvoiceLine;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Models\VehicleCategory;
use Modules\Vehicles\Policies\VehicleCategoryPolicy;

/**
 * The fleet's category vocabulary, and the one question the office actually
 * asks of it: **can a vehicle of this kind be priced?** (ADR-0050 §5.)
 *
 * Plain Eloquent, no repository — ADR-0002: simple single-model CRUD does not
 * earn one. `coverage()` is the exception that would, on the aggregate rule,
 * except that it is one screen's read and lives beside the CRUD it explains.
 */
class VehicleCategoryService
{
    /**
     * Every category, in reading order, each carrying what is holding it.
     *
     * The three computed values are attached as model attributes, which is
     * the same mechanism `withCount()` uses — they are not columns and are
     * not persisted. `VehicleCategoryResource` reads them and nothing else
     * does.
     *
     * @return Collection<int, VehicleCategory>
     */
    public function list(User $actor): Collection
    {
        $categories = VehicleCategory::query()->ordered()->get();

        $vehicles = VehicleCategoryPolicy::mayReadFleetCounts($actor)
            ? $this->vehicleCountsByCategory()
            : [];
        $coverage = $this->coverage($actor);

        // How many vehicles the platform runs of each kind is **roster
        // information** — `docs/security-gate.md` F2 keeps the roster from
        // clients, and a corporate transport officer reaches this endpoint
        // now that the booking form needs the names (ADR-0051). They get the
        // names; they do not get the fleet's composition.
        $showCounts = VehicleCategoryPolicy::mayReadFleetCounts($actor);

        foreach ($categories as $category) {
            if ($showCounts) {
                $category->setAttribute('vehicles_count', $vehicles[$category->key] ?? 0);
            }

            $category->setAttribute('rate_cards_total', $coverage['total']);
            $category->setAttribute(
                'unpriced_rate_cards',
                $coverage['unpriced'][$category->key] ?? $coverage['all_cards'],
            );
        }

        return $categories;
    }

    /** @param  array<string, mixed>  $data */
    public function create(array $data): VehicleCategory
    {
        return VehicleCategory::create($data);
    }

    /** @param  array<string, mixed>  $data */
    public function update(VehicleCategory $category, array $data): VehicleCategory
    {
        $category->update($data);

        return $category->refresh();
    }

    public function delete(VehicleCategory $category): void
    {
        $category->delete();
    }

    /**
     * What is holding this key, for the 409 that refuses a delete.
     *
     * All three are counted, not short-circuited on the first hit, because
     * the message names them and "3 vehicles" alone would send somebody to
     * reassign three vehicles and then hit the same refusal on an invoice
     * line they were never told about.
     *
     * **Invoice lines are counted through `allTenants()`.** A category is
     * platform-wide (ADR-0005) and a delete is permanent, so "is any client's
     * issued invoice holding this string?" has to be asked of every client's
     * invoices — a tenant-scoped count would answer "nothing is using it" to
     * a platform actor and let the row be destroyed while a bank's invoice
     * still names it. Nothing about the row is returned, only whether any
     * exist, so this reads no client data across a boundary.
     *
     * @return array{vehicles: int, rate_card_rates: int, invoice_lines: int}
     */
    public function usage(VehicleCategory $category): array
    {
        return [
            'vehicles' => Vehicle::withTrashed()->where('category', $category->key)->count(),
            'rate_card_rates' => RateCardRate::allTenants()
                ->where('vehicle_category', $category->key)
                ->count(),
            'invoice_lines' => InvoiceLine::allTenants()
                ->where('vehicle_category', $category->key)
                ->count(),
        ];
    }

    /**
     * How many vehicles carry each key.
     *
     * Soft-deleted vehicles are excluded here and **included** in `usage()`
     * above, and the difference is intentional: this figure tells the office
     * how much of the live fleet is affected by retiring a category, while
     * that one answers whether the row may be destroyed — and a soft-deleted
     * vehicle can be restored, so its category must survive.
     *
     * @return array<string, int>
     */
    private function vehicleCountsByCategory(): array
    {
        /** @var array<string, int> $counts */
        $counts = Vehicle::query()
            ->select('category', DB::raw('count(*) as aggregate'))
            ->groupBy('category')
            ->pluck('aggregate', 'category')
            ->all();

        return $counts;
    }

    /**
     * Which rate cards do **not** price each category, on their newest
     * version.
     *
     * ## Why "newest version" and not "the one in force"
     *
     * A version applies to a trip by `effective_from` against the *trip's*
     * date (`RateCardResolver`), so there is no single "current" version —
     * a back-dated version changes what an old trip would price at. The
     * newest is the honest answer to the question this screen asks, which is
     * about trips that have not happened yet: it is what the next trip on
     * that card will price against, and it is the version the office would
     * copy to add a price.
     *
     * ## `forActor()` on every one of the three queries
     *
     * `RateCard`, `RateCardVersion` and `RateCardRate` are all tenant-scoped
     * — the last one through `PricedRate`, so grepping `RateCardRate` for
     * `BelongsToTenant` finds nothing while it is fully scoped.
     * `RateCardController::versionsFor()` documents at length what happens if
     * only the parent is scoped: the cards load and every one comes back with
     * nothing priced, rendering as a confident, false claim about a tariff
     * that is pricing live trips. Here that would read as "not priced on any
     * rate card" beside every category on the screen — a warning banner
     * about a platform that is billing correctly.
     *
     * @return array{total: int, all_cards: list<array{id: int, name: string}>, unpriced: array<string, list<array{id: int, name: string}>>}
     */
    private function coverage(User $actor): array
    {
        $cards = RateCard::query()
            ->forActor($actor)
            ->where('status', RateCardStatus::ACTIVE)
            ->orderBy('name')
            ->get(['id', 'name']);

        // `array_values`, not `->values()->all()`. Both give a list at
        // runtime; only this one proves it to PHPStan, and the difference
        // is not cosmetic — a non-list array serialises to a JSON *object*,
        // so the client would receive `{"0": {...}}` where it expects an
        // array and render nothing at all.
        $allCards = array_values(
            $cards->map(fn (RateCard $card) => ['id' => $card->id, 'name' => $card->name])->all()
        );

        if ($cards->isEmpty()) {
            return ['total' => 0, 'all_cards' => [], 'unpriced' => []];
        }

        // Newest version per card. Ordered ascending and keyed by card, so
        // the last write per key wins — one pass, no per-card query.
        $newest = RateCardVersion::query()
            ->forActor($actor)
            ->whereIn('rate_card_id', $cards->pluck('id'))
            ->orderBy('version')
            ->get(['id', 'rate_card_id'])
            ->keyBy('rate_card_id')
            ->map(fn (RateCardVersion $version) => $version->id);

        if ($newest->isEmpty()) {
            // Cards exist and none has a version. Every category is unpriced
            // on every card, which is what the empty `unpriced` map means
            // via `list()`'s fallback to `all_cards`.
            return ['total' => count($allCards), 'all_cards' => $allCards, 'unpriced' => []];
        }

        $versionToCard = $newest->flip();

        $pricedCardsByCategory = RateCardRate::query()
            ->forActor($actor)
            ->whereIn('rate_card_version_id', $newest->values())
            ->get(['rate_card_version_id', 'vehicle_category'])
            ->groupBy('vehicle_category')
            ->map(fn (Collection $rates) => $rates
                ->map(fn (RateCardRate $rate) => $versionToCard[$rate->rate_card_version_id] ?? null)
                ->filter()
                ->unique()
                ->values()
                ->all());

        $unpriced = [];

        foreach ($pricedCardsByCategory as $category => $cardIds) {
            $unpriced[$category] = array_values(array_filter(
                $allCards,
                fn (array $card) => ! in_array($card['id'], $cardIds, true),
            ));
        }

        return ['total' => count($allCards), 'all_cards' => $allCards, 'unpriced' => $unpriced];
    }
}
