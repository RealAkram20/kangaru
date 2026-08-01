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
     * @param  array{name: string, description?: string|null, is_default?: bool, version: array<string, mixed>}  $data
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

            return $card->refresh();
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
            $locked = RateCard::whereKey($card->id)->lockForUpdate()->firstOrFail();

            $version = RateCardVersion::create([
                'tenant_id' => $locked->tenant_id,
                'rate_card_id' => $locked->id,
                'version' => $this->nextVersionNumber($locked),
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
                RateCardRate::create([
                    'tenant_id' => $locked->tenant_id,
                    'rate_card_version_id' => $version->id,
                    'vehicle_category' => $rate['vehicle_category'],
                    'base_fare_minor' => (int) ($rate['base_fare_minor'] ?? 0),
                    'per_km_minor' => (int) ($rate['per_km_minor'] ?? 0),
                    'per_waiting_minute_minor' => (int) ($rate['per_waiting_minute_minor'] ?? 0),
                    'minimum_charge_minor' => (int) ($rate['minimum_charge_minor'] ?? 0),
                    'maximum_charge_minor' => isset($rate['maximum_charge_minor'])
                        ? (int) $rate['maximum_charge_minor']
                        : null,
                ]);
            }

            return $version->load('rates');
        });
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

    private function nextVersionNumber(RateCard $card): int
    {
        return (int) $card->versions()->reorder()->max('version') + 1;
    }
}
