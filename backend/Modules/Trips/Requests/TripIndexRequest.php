<?php

namespace Modules\Trips\Requests;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Trips\Enums\TripStatus;

class TripIndexRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['status', 'vehicle_id', 'driver_id', 'cursor'];

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
            'status' => ['sometimes', Rule::enum(TripStatus::class)],
            'vehicle_id' => ['sometimes', 'integer'],
            'driver_id' => ['sometimes', 'integer'],
            'cursor' => ['sometimes', 'string'],

            // Validated only for the reader who may use it. See
            // BookingIndexRequest — validating it for everyone let the
            // `exists` rule's presence or absence reveal which clients
            // exist.
            ...($this->allowsClientFilter()
                ? ['tenant_id' => ['sometimes', 'integer', 'exists:tenants,id']]
                : []),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $unknown = array_diff(array_keys($this->query()), $this->allowedKeys());

            foreach ($unknown as $key) {
                $validator->errors()->add($key, 'This filter is not recognized.');
            }
        });
    }

    /**
     * @return array<int, string>
     */
    private function allowedKeys(): array
    {
        return $this->allowsClientFilter()
            ? [...self::ALLOWED_KEYS, 'tenant_id']
            : self::ALLOWED_KEYS;
    }

    /** Whether this reader's list spans clients, and so has one to choose. */
    private function allowsClientFilter(): bool
    {
        $actor = $this->user();

        return $actor instanceof User && $actor->isPlatformLevel();
    }
}
