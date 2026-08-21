<?php

namespace Modules\Vehicles\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * "This is a category the fleet currently offers" — the one definition of
 * that sentence (ADR-0050 §4).
 *
 * It replaces `Rule::in(Vehicle::CATEGORIES)` at four call sites:
 * `StoreVehicleRequest`, `UpdateVehicleRequest`, `ValidatesInlineVehicle` and
 * `StoreRateCardVersionRequest`. **One rule, because four hand-mirrored lists
 * drifting apart is the failure ADR-0050 exists to end** — and it had already
 * happened twice: once when the walk-in tariff priced `boda` and `tricycle`
 * that the constant did not list, and again when `DriverFormDialog` shipped a
 * seven-item copy that omitted `boda` on a platform whose fleet is mostly
 * boda riders.
 *
 * ## Why `alsoAllow` exists
 *
 * A retired category must stay editable **on the records that already carry
 * it**. Without this, retiring `tricycle` would make every tricycle in the
 * fleet uneditable: a clerk correcting a colour or a VIN would be refused,
 * because the form resends the category and the category is no longer
 * offered. The category is not what they are changing, and the platform would
 * be enforcing a rule retroactively against a record that predates it.
 *
 * `UpdateVehicleRequest` passes the vehicle's stored category. Nothing else
 * passes anything, so nothing else can widen the list by accident.
 *
 * ## Why it queries rather than caching
 *
 * A handful of rows, read on write paths only, on a screen a few staff use a
 * few times a day. A cache here would buy nothing measurable and would cost
 * the one behaviour that matters: a category created in one browser tab must
 * be choosable in the next request, or the office reports it as broken.
 */
class ActiveVehicleCategory implements ValidationRule
{
    /**
     * @param  string|null  $alsoAllow  A key to accept even when retired,
     *                                  because the record being edited
     *                                  already carries it.
     */
    public function __construct(private readonly ?string $alsoAllow = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('Choose a vehicle category.');

            return;
        }

        if ($this->alsoAllow !== null && $value === $this->alsoAllow) {
            return;
        }

        $exists = VehicleCategory::query()
            ->active()
            ->where('key', $value)
            ->exists();

        if ($exists) {
            return;
        }

        // One message for "never existed" and for "retired". The office's
        // next action is the same either way — pick one that is offered —
        // and distinguishing them would mean the error text is where
        // somebody learns the fleet used to run tricycles.
        $fail('That vehicle category is not one the fleet currently offers.');
    }
}
