<?php

namespace Modules\Billing\Requests;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Enums\RoundingMode;
use Modules\Billing\Models\RateCardVersion;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\Zone;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Vehicles\Models\Vehicle;

/**
 * Validates one immutable rate card version and its per-category rates.
 *
 * Strict on purpose. A version cannot be edited after it is created, so a
 * mistake here is corrected by superseding the version — which is fine, but
 * every invoice raised in between carries the mistake forever. The cheapest
 * place to catch a rate card that cannot price a trip is before it exists.
 */
class StoreRateCardVersionRequest extends FormRequest
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
        return self::versionRules();
    }

    /**
     * Shared with StoreRateCardRequest, which nests a version under
     * `version.*` when creating a card and its first prices in one call.
     * One definition, so the two entry points cannot drift into accepting
     * different rate cards.
     *
     * @return array<string, mixed>
     */
    public static function versionRules(string $prefix = ''): array
    {
        return [
            $prefix.'effective_from' => ['required', 'date'],
            $prefix.'rounding_mode' => ['nullable', Rule::enum(RoundingMode::class)],
            $prefix.'free_waiting_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],

            // Night window: both times or neither. A start with no end is a
            // window with no closing edge, which would price every trip
            // after 22:00 at the night rate forever.
            $prefix.'night_starts_at' => ['nullable', 'required_with:'.$prefix.'night_ends_at', 'date_format:H:i'],
            $prefix.'night_ends_at' => ['nullable', 'required_with:'.$prefix.'night_starts_at', 'date_format:H:i'],
            // Basis points. Floor of 10000 (1.0x): a "night rate" that
            // discounts is a discount, and discounts are deferred rather
            // than smuggled in through this field. Ceiling of 5.0x stops a
            // fat-fingered 125000 from billing a client 12.5x.
            $prefix.'night_multiplier_bp' => ['nullable', 'integer', 'min:10000', 'max:50000'],
            // Which witness this version bills on (ADR-0045 §3). Optional
            // and defaulting to `odometer` — today's behaviour — so a client
            // that predates the field issues versions exactly as before.
            $prefix.'distance_policy' => ['nullable', Rule::enum(DistancePolicy::class)],

            $prefix.'notes' => ['nullable', 'string', 'max:1000'],

            // At least one category must be priced, or the version cannot
            // invoice anything.
            $prefix.'rates' => ['required', 'array', 'min:1'],
            $prefix.'rates.*.vehicle_category' => ['required', 'string', Rule::in(Vehicle::CATEGORIES)],
            $prefix.'rates.*.base_fare_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.per_km_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.per_waiting_minute_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.minimum_charge_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.maximum_charge_minor' => ['nullable', 'integer', 'min:0'],

            // Zone prices are nested **inside** the category they override
            // (ADR-0021, billing half). The category is not repeated here
            // and cannot be: a zone price for a category the version does
            // not otherwise price has nowhere to go, so the rate card that
            // looks configured and cannot bill a trip outside the zone is
            // not a mistake anybody can make.
            $prefix.'rates.*.zone_rates' => ['nullable', 'array'],
            $prefix.'rates.*.zone_rates.*.zone_id' => ['required', 'integer'],
            $prefix.'rates.*.zone_rates.*.base_fare_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.zone_rates.*.per_km_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.zone_rates.*.per_waiting_minute_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.zone_rates.*.minimum_charge_minor' => ['nullable', 'integer', 'min:0'],
            $prefix.'rates.*.zone_rates.*.maximum_charge_minor' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $v) => self::validateRates($v, $this->input('rates', []), 'rates'));
    }

    /**
     * The cross-field rules the `rules()` array cannot express, applied by
     * both entry points.
     *
     * @param  mixed  $rates
     */
    public static function validateRates(Validator $validator, $rates, string $key): void
    {
        if (! is_array($rates)) {
            return;
        }

        $seen = [];
        $priceableZones = self::priceableZones();

        foreach ($rates as $index => $rate) {
            if (! is_array($rate)) {
                continue;
            }

            $category = $rate['vehicle_category'] ?? null;

            // Two rows for one category means the version prices that
            // category twice and rateFor() would silently take whichever
            // came back first.
            if (is_string($category)) {
                if (isset($seen[$category])) {
                    $validator->errors()->add(
                        "{$key}.{$index}.vehicle_category",
                        "The vehicle category \"{$category}\" is priced more than once in this version."
                    );
                }

                $seen[$category] = true;
            }

            self::validateChargeCap($validator, $rate, "{$key}.{$index}");
            self::validateZoneRates($validator, $rate['zone_rates'] ?? null, "{$key}.{$index}.zone_rates", $priceableZones);
        }
    }

    /**
     * A maximum below the minimum is unresolvable: the pricing engine checks
     * the minimum first, so the maximum would never apply and the card would
     * quietly not mean what it says.
     *
     * Shared between a default rate and a zone rate because a zone rate is a
     * complete price with the same two fields — one rule, so the two cannot
     * come to disagree about what a valid price is.
     *
     * @param  array<string, mixed>  $rate
     */
    private static function validateChargeCap(Validator $validator, array $rate, string $path): void
    {
        $minimum = (int) ($rate['minimum_charge_minor'] ?? 0);
        $maximum = $rate['maximum_charge_minor'] ?? null;

        if ($maximum !== null && (int) $maximum < $minimum) {
            $validator->errors()->add(
                "{$path}.maximum_charge_minor",
                'The maximum charge cannot be lower than the minimum charge.'
            );
        }
    }

    /**
     * The zone prices nested under one vehicle category.
     *
     * @param  mixed  $zoneRates
     * @param  array<int, string>  $priceableZones  id => name
     */
    private static function validateZoneRates(Validator $validator, $zoneRates, string $path, array $priceableZones): void
    {
        if (! is_array($zoneRates)) {
            return;
        }

        $seen = [];

        foreach ($zoneRates as $index => $zoneRate) {
            if (! is_array($zoneRate)) {
                continue;
            }

            self::validateChargeCap($validator, $zoneRate, "{$path}.{$index}");

            $zoneId = $zoneRate['zone_id'] ?? null;

            if (! is_int($zoneId) && ! (is_string($zoneId) && ctype_digit($zoneId))) {
                continue;
            }

            $zoneId = (int) $zoneId;

            // The unique index on (rate_card_rate_id, zone_id) would catch
            // this too, but as a 500 from a duplicate-key exception rather
            // than a message pointing at the row somebody entered twice.
            if (isset($seen[$zoneId])) {
                $validator->errors()->add(
                    "{$path}.{$index}.zone_id",
                    'This zone is priced more than once for this vehicle category.'
                );
            }

            $seen[$zoneId] = true;

            // Deliberately one message for "does not exist", "belongs to
            // another client" and "is switched off". Distinguishing them
            // would tell a client's finance officer that another client's
            // zone exists — the same reasoning that makes a cross-tenant
            // read a 404 and never a 403 (AGENTS.md).
            if (! isset($priceableZones[$zoneId])) {
                $validator->errors()->add(
                    "{$path}.{$index}.zone_id",
                    'That zone is not available for pricing. Choose an active pricing or client zone.'
                );
            }
        }
    }

    /**
     * The zones a rate card may name: active, visible to this tenant, and of
     * a kind `ZoneResolver::pricingZoneAt()` will actually return.
     *
     * The kind check is the one that earns its place. A rate attached to a
     * depot or branch boundary would be accepted, stored, and then never
     * selected by anything — a price the operator can see on the card and
     * that no invoice will ever use. Refusing it at the door is the only
     * point at which that is still correctable, because the version it would
     * land on is immutable the moment it is created.
     *
     * `active` is checked here and **not** rechecked at pricing time on
     * purpose: a zone switched off after the card was written stops being
     * resolved by `ZoneResolver`, so its rate quietly stops applying and the
     * category's default takes over. That is the right behaviour for an
     * immutable version — it must not be invalidated by a later map edit.
     *
     * @return array<int, string> id => name
     */
    private static function priceableZones(): array
    {
        /** @var array<int, string> $zones */
        $zones = Zone::query()
            ->where('active', true)
            ->whereIn('kind', [ZoneKind::PRICING, ZoneKind::CLIENT])
            ->visibleTo(app(TenantContext::class)->get())
            ->pluck('name', 'id')
            ->all();

        return $zones;
    }

    /**
     * @return array<string, mixed>
     */
    public function versionData(): array
    {
        return [
            'effective_from' => $this->validated('effective_from'),
            'rounding_mode' => $this->validated('rounding_mode'),
            'free_waiting_minutes' => $this->validated('free_waiting_minutes') ?? 0,
            'night_starts_at' => $this->validated('night_starts_at'),
            'night_ends_at' => $this->validated('night_ends_at'),
            'night_multiplier_bp' => $this->validated('night_multiplier_bp')
                ?? RateCardVersion::NO_MULTIPLIER_BP,
            'distance_policy' => $this->validated('distance_policy'),
            'notes' => $this->validated('notes'),
            'rates' => $this->validated('rates'),
        ];
    }
}
