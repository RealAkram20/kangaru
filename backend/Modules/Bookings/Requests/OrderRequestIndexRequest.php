<?php

namespace Modules\Bookings\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;

class OrderRequestIndexRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['status', 'service_type', 'page'];

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
            'status' => ['nullable', Rule::enum(OrderRequestStatus::class)],
            'service_type' => ['nullable', Rule::enum(OrderRequestServiceType::class)],
            'page' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v) {
            foreach (array_keys($this->query()) as $key) {
                if (! in_array((string) $key, self::ALLOWED_KEYS, true)) {
                    $v->errors()->add((string) $key, 'This filter is not recognized on this endpoint.');
                }
            }
        });
    }
}
