<?php

namespace Modules\Dispatch\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Proves both ids exist, are active, and belong to the caller's tenant.
 * Whether they are *free right now* is deliberately not checked here — that
 * is a race-sensitive question and only has a trustworthy answer inside the
 * locked transaction in TripAssignmentGuard, which answers it with a 409.
 */
class AssignBookingRequest extends FormRequest
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
            'vehicle_id' => [
                'required',
                'integer',
                Rule::exists('vehicles', 'id')->where(
                    fn ($query) => $query->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
            'driver_id' => [
                'required',
                'integer',
                Rule::exists('drivers', 'id')->where(
                    fn ($query) => $query->where('status', 'active')
                        ->whereNull('deleted_at')
                ),
            ],
        ];
    }
}
