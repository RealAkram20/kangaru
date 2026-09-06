<?php

namespace Modules\Fleet\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Editing a fleet company, and suspending one.
 *
 * `status` is the only consequential field here and it has two values. There
 * is no `deleted`: `OperatorPolicy::delete()` is `false`, because six
 * operational tables carry `operator_id` and `operator_client` restricts on
 * delete — removing a row would either fail against its own history or orphan
 * it. A fleet that leaves is suspended, which keeps its trips explicable.
 */
class UpdateOperatorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'status' => ['sometimes', Rule::in(['active', 'suspended'])],
            /*
             * No `plan_id`. It was accepted here once, and the controller's
             * bare `update()` meant it moved a fleet between tiers without
             * `PlanAllowance` — the ADR-0058 §4 refusal ("a move to a plan
             * smaller than the fleet's current usage is refused, and the
             * refusal names the figures") that only `PlanController::assign`
             * runs. Two routes to one column, one guarded, is how a fleet
             * quietly ends up on a plan its own roster already exceeds; a
             * plan move goes through `PUT /operators/{operator}/plan` alone.
             */
        ];
    }
}
