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
            // The plan a fleet is on (ADR-0058). Editable here so head office
            // can move a fleet between tiers; what each tier *means* —
            // limits, price, period — is K7's and nothing here presumes it.
            'plan_id' => ['sometimes', 'integer', Rule::exists('plans', 'id')],
        ];
    }
}
