<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Drivers\Enums\EarningsPeriod;

/**
 * The one parameter the earnings endpoint takes.
 *
 * A Form Request for a single optional enum looks like ceremony, and it is
 * not: AGENTS.md's API standards say an unknown filter **returns 422 rather
 * than being silently ignored**, and `EarningsPeriod::from()` on an
 * unvalidated string throws a `ValueError` that surfaces as a 500. Validating
 * here turns "?period=fortnight" into the documented 422 with a field-level
 * message instead of an exception in the log.
 *
 * Authorisation is deliberately open: the controller resolves the driver from
 * the token and refuses an account with no driver profile. There is no id to
 * authorise against — see the controller's docblock.
 */
class DriverEarningsRequest extends FormRequest
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
        return [
            // Optional, defaulting to `day` in the controller. A driver
            // opening the screen wants today; making them name the period to
            // get an answer would be a parameter for its own sake.
            'period' => ['sometimes', Rule::enum(EarningsPeriod::class)],
        ];
    }
}
