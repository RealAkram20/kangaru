<?php

namespace Modules\Bookings\Requests;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Bookings\Enums\BookingStatus;

class BookingIndexRequest extends FormRequest
{
    /**
     * Query params this endpoint recognizes. Anything else fails
     * validation — AGENTS.md: "unknown filters return 422, not silence."
     */
    private const ALLOWED_KEYS = ['status', 'dispatchable', 'q', 'from', 'to', 'cursor'];

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
            'status' => ['sometimes', Rule::enum(BookingStatus::class)],
            // The dispatch queue: everything still awaiting a vehicle.
            'dispatchable' => ['sometimes', 'boolean'],
            // Free text across route, passenger, status and — for a reader
            // whose queue spans clients — the client's name. Bounded so a
            // search box cannot be used to send a megabyte to `LIKE`.
            'q' => ['sometimes', 'string', 'max:120'],
            // Dates, not datetimes — same reasoning as AuditLogIndexRequest:
            // "pickups this week" is the question, and nobody asks it to the
            // second. They bound the *pickup* moment; see the controller for
            // what that means for an immediate booking.
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'cursor' => ['sometimes', 'string'],

            // `tenant_id` is validated only for the reader who may use it.
            //
            // Not a tidiness choice — validating it for everyone was an
            // information leak, and a test caught it. `exists:tenants,id`
            // adds "The selected tenant id is invalid." when the id names
            // nothing, and stays silent when it names a real client. A
            // corporate employee comparing the two responses could
            // enumerate the platform's entire client list one id at a
            // time. Omitting the rule makes both answers identical.
            ...($this->allowsClientFilter()
                ? ['tenant_id' => ['sometimes', 'integer', 'exists:tenants,id']]
                : []),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'to.after_or_equal' => 'The end of the range cannot fall before its start.',
            'from.date_format' => 'Dates are YYYY-MM-DD, e.g. 2026-03-01.',
            'to.date_format' => 'Dates are YYYY-MM-DD, e.g. 2026-03-31.',
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
     * `tenant_id` exists only for a reader whose queue spans clients.
     *
     * Refusing it from a client's own user goes through the *same* path as
     * any unrecognised filter rather than a special message, and that is
     * deliberate on two counts. It is accurate — from that account there
     * is no such filter, because there was never a choice of client to
     * make. And it answers identically whether the id names a real tenant
     * or not, so the endpoint cannot be used to discover which clients
     * exist. A distinct "not available to you" would have been an oracle
     * with better manners.
     *
     * @return array<int, string>
     */
    private function allowedKeys(): array
    {
        return $this->allowsClientFilter()
            ? [...self::ALLOWED_KEYS, 'tenant_id']
            : self::ALLOWED_KEYS;
    }

    /** Whether this reader's queue spans clients, and so has one to choose. */
    private function allowsClientFilter(): bool
    {
        $actor = $this->user();

        return $actor instanceof User && $actor->isPlatformLevel();
    }
}
