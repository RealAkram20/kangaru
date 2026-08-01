<?php

namespace Modules\Billing\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Billing\Enums\RoundingMode;
use Modules\Billing\Models\RateCardVersion;
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
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $v) => self::validateRates($v, $this->input('rates', []), 'rates'));
    }

    /**
     * The two cross-field rules the `rules()` array cannot express, applied
     * by both entry points.
     *
     * @param  mixed  $rates
     */
    public static function validateRates(Validator $validator, $rates, string $key): void
    {
        if (! is_array($rates)) {
            return;
        }

        $seen = [];

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

            $minimum = (int) ($rate['minimum_charge_minor'] ?? 0);
            $maximum = $rate['maximum_charge_minor'] ?? null;

            // A maximum below the minimum is unresolvable: the pricing
            // engine checks the minimum first, so the maximum would never
            // apply and the card would quietly not mean what it says.
            if ($maximum !== null && (int) $maximum < $minimum) {
                $validator->errors()->add(
                    "{$key}.{$index}.maximum_charge_minor",
                    'The maximum charge cannot be lower than the minimum charge.'
                );
            }
        }
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
            'notes' => $this->validated('notes'),
            'rates' => $this->validated('rates'),
        ];
    }
}
