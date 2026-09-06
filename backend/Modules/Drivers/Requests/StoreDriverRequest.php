<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Creating a driver from the console (ADR-0048 §8).
 *
 * This request has accepted `vehicle_id` since ADR-0009 and **no screen has
 * ever sent it**, because no screen has ever created a driver at all. What is
 * new here is the other half of the same question: whether that vehicle is
 * the driver's own, and — when it is one the fleet has never seen — the
 * vehicle itself, so that a clerk onboarding a boda rider does not have to
 * abandon a half-typed form to go and register the machine somewhere else.
 */
class StoreDriverRequest extends FormRequest
{
    use ValidatesInlineVehicle;

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
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:50'],
            // The vehicle this driver drives. Nullable: a corporate driver
            // takes whatever the depot hands them, and presence carries the
            // per-shift answer for them. For a boda rider it is the driver's
            // own machine and effectively permanent.
            //
            // The fleet is platform-owned and unscoped by tenant (ADR-0005),
            // so `exists` needs no tenant clause — adding one would be the
            // mistake, not the safeguard.
            'vehicle_id' => ['nullable', 'integer', Rule::exists('vehicles', 'id')->whereNull('deleted_at')],
            /**
             * Whose vehicle it is (ADR-0048 §7).
             *
             * Independent of `vehicle_id` on purpose. A driver who owns a
             * vehicle the fleet has not recorded yet sends `owns_vehicle`
             * with a nested `vehicle` and no id; a depot driver sends an id
             * and `false`. Neither is derivable from the other.
             */
            'owns_vehicle' => ['nullable', 'boolean'],
            'email' => ['nullable', 'email'],
            'license_number' => [
                'required',
                'string',
                'max:100',
                // Global, not per tenant — see StoreVehicleRequest.
                Rule::unique('drivers'),
            ],
            'license_expiry' => ['required', 'date'],
            'status' => ['nullable', 'string', 'in:active,suspended,inactive'],
            ...$this->inlineVehicleRules(),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $this->validateInlineVehicle($validator);
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return $this->inlineVehicleMessages();
    }
}
