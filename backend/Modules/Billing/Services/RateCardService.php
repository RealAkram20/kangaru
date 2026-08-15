<?php

namespace Modules\Billing\Services;

use App\Models\User;
use App\Support\Money\Shillings;
use Illuminate\Support\Facades\DB;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Billing\Enums\RoundingMode;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Models\RateCardZoneRate;

/**
 * Creates rate cards and adds versions to them.
 *
 * There is no `update()` for prices, and that absence is the design.
 * AGENTS.md: "Rate cards are versioned and immutable once used. Editing
 * creates a new version." So the only way to change what a client is
 * charged is `addVersion()`, and every invoice ever issued keeps pointing
 * at the version that was in force when it was raised.
 */
class RateCardService
{
    /**
     * Expects `name`, optionally `description` and `is_default`, and a
     * `version` array in the shape addVersion() takes. Typed loosely
     * because it arrives straight from a validated FormRequest, which
     * already guarantees the shape and cannot express it as a PHPStan
     * array shape.
     *
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, User $actor): RateCard
    {
        return DB::transaction(function () use ($data, $actor) {
            $card = RateCard::create([
                'tenant_id' => $actor->tenant_id,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'status' => RateCardStatus::ACTIVE,
                'is_default' => false,
            ]);

            $this->addVersion($card, $data['version'], $actor);

            // Promoted after the version exists, so a card can never become
            // the tenant's default while it still has no prices on it — the
            // next invoice would resolve to it and fail.
            if ($data['is_default'] ?? false) {
                $this->makeDefault($card);
            }

            // `forActor`, not `refresh()`. The model's own refresh goes back
            // through `TenantScope`, which fails closed — so a platform
            // actor creating the public tariff (ADR-0026 §4) would insert
            // the row correctly and then fail to read it back, with a
            // "no query results" for a card created two statements earlier.
            //
            // `$actor->tenant_id` is already what decides the card's owner
            // above, so a platform actor makes a platform card; this is the
            // read side of that same fact.
            return RateCard::forActor($actor)->findOrFail($card->id);
        });
    }

    /**
     * Adds the next immutable version to a card.
     *
     * @param  array<string, mixed>  $data
     */
    public function addVersion(RateCard $card, array $data, User $actor): RateCardVersion
    {
        return DB::transaction(function () use ($card, $data, $actor) {
            // The version number is derived from what already exists, so
            // two concurrent additions must not both read the same maximum.
            // Locking the card row serialises them; the unique index on
            // (rate_card_id, version) is the backstop if this is ever
            // bypassed.
            /** @var RateCard $locked */
            $locked = RateCard::forActor($actor)->whereKey($card->id)->lockForUpdate()->firstOrFail();

            $version = RateCardVersion::create([
                'tenant_id' => $locked->tenant_id,
                'rate_card_id' => $locked->id,
                'version' => $this->nextVersionNumber($locked, $actor),
                'effective_from' => $data['effective_from'],
                'currency' => Shillings::currency(),
                'rounding_mode' => RoundingMode::tryFrom((string) ($data['rounding_mode'] ?? ''))
                    ?? RoundingMode::default(),
                'free_waiting_minutes' => $data['free_waiting_minutes'] ?? 0,
                'night_starts_at' => $data['night_starts_at'] ?? null,
                'night_ends_at' => $data['night_ends_at'] ?? null,
                'night_multiplier_bp' => $data['night_multiplier_bp'] ?? RateCardVersion::NO_MULTIPLIER_BP,
                'created_by_user_id' => $actor->id,
                'notes' => $data['notes'] ?? null,
            ]);

            /** @var array<int, array<string, mixed>> $rates */
            $rates = $data['rates'];

            foreach ($rates as $rate) {
                $created = RateCardRate::create([
                    'tenant_id' => $locked->tenant_id,
                    'rate_card_version_id' => $version->id,
                    'vehicle_category' => $rate['vehicle_category'],
                    ...self::amounts($rate),
                ]);

                /** @var array<int, array<string, mixed>> $zoneRates */
                $zoneRates = $rate['zone_rates'] ?? [];

                foreach ($zoneRates as $zoneRate) {
                    // Attached to the rate, not to the version: a zone price
                    // for a category the version does not otherwise price
                    // has nowhere to be written (ADR-0021, billing half).
                    RateCardZoneRate::create([
                        'tenant_id' => $locked->tenant_id,
                        'rate_card_rate_id' => $created->id,
                        'zone_id' => (int) $zoneRate['zone_id'],
                        ...self::amounts($zoneRate),
                    ]);
                }
            }

            return $version->load('rates.zoneRates.zone');
        });
    }

    /**
     * The five money columns a rate carries, defaulted the way the schema
     * defaults them.
     *
     * Shared by a default rate and a zone rate because they are the same
     * five amounts with the same meanings — a second copy is where one of
     * them quietly stops being written.
     *
     * @param  array<string, mixed>  $rate
     * @return array<string, int|null>
     */
    private static function amounts(array $rate): array
    {
        return [
            'base_fare_minor' => (int) ($rate['base_fare_minor'] ?? 0),
            'per_km_minor' => (int) ($rate['per_km_minor'] ?? 0),
            'per_waiting_minute_minor' => (int) ($rate['per_waiting_minute_minor'] ?? 0),
            'minimum_charge_minor' => (int) ($rate['minimum_charge_minor'] ?? 0),
            // Null means uncapped, never "capped at zero".
            'maximum_charge_minor' => isset($rate['maximum_charge_minor'])
                ? (int) $rate['maximum_charge_minor']
                : null,
        ];
    }

    /**
     * Makes this the card invoice generation reaches for when no card is
     * named. Exactly one card per tenant holds the flag; MySQL cannot
     * express "at most one true per tenant" as a constraint, so the demotion
     * and the promotion share a transaction instead.
     */
    public function makeDefault(RateCard $card): RateCard
    {
        return DB::transaction(function () use ($card) {
            RateCard::query()
                ->where('is_default', true)
                ->whereKeyNot($card->id)
                ->each(function (RateCard $other) {
                    $other->is_default = false;
                    $other->save();
                });

            $card->is_default = true;
            $card->save();

            return $card;
        });
    }

    /**
     * The next version number for this card, counted the way the card itself
     * was loaded.
     *
     * **`forActor()`, not `$card->versions()`.** The plain relation carries
     * the global `TenantScope`, which fails closed — `1 = 0` — whenever no
     * tenant is bound. Platform staff have no tenant of their own, so for a
     * **platform-owned** rate card (`tenant_id` null, which the public walk-in
     * tariff is) the count came back empty and this returned 1 for ever. The
     * insert then died on the `(rate_card_id, version)` unique index, so the
     * public tariff could not be given a second version through the API at
     * all — a 500, every time.
     *
     * It was never noticed because that card is the only platform-owned one
     * and it had exactly one version. `Vehicle::CATEGORIES` hid it further:
     * the request refused the tariff's own `boda` and `tricycle` rows with a
     * 422 before execution ever reached here.
     *
     * Reading past the scope grants nothing. `$card` has already been resolved
     * through `RateCard::forActor()` and authorised by the policy; this only
     * asks how many versions that same card has, filtered to it by id.
     */
    private function nextVersionNumber(RateCard $card, User $actor): int
    {
        return (int) RateCardVersion::forActor($actor)
            ->where('rate_card_id', $card->getKey())
            ->reorder()
            ->max('version') + 1;
    }
}
