<?php

namespace Modules\Bookings\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Bookings\Enums\OrderRequestStatus;

/**
 * A dispatcher's move on a walk-in request: a status, optionally with
 * notes. Whether the move is *legal from the current status* is
 * OrderRequestService's question, not validation's — this only ensures the
 * status named exists.
 */
class UpdateOrderRequestRequest extends FormRequest
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
            'status' => ['required', Rule::enum(OrderRequestStatus::class)],
            'dispatcher_notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
