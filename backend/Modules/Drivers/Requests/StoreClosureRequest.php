<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A driver asking for their account to be closed (ADR-0043).
 *
 * Authorisation is open here and settled in the controller, as every other
 * `/me` write in this module does it: the driver is the token, so there is no
 * id to authorise against.
 */
class StoreClosureRequest extends FormRequest
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
            /*
             * **Optional, deliberately.** Requiring somebody to justify leaving
             * is a dark pattern, and a mandatory box produces "." far more often
             * than it produces a reason. The office reads it where it is given
             * and the screen asks without insisting.
             */
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
