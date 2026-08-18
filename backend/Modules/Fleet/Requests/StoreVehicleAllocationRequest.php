<?php

namespace Modules\Fleet\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Agreeing a contract.
 *
 * ADR-0009 notes that the shape here is ADR-0007's, not ADR-0006's: this
 * names a tenant in the **request body** rather than acting on an existing
 * tenant-owned record, so `BindSubjectTenant` has nothing to read and the
 * tenant must come from the validated payload with an explicit
 * authorization check. That check is `tenant_id`'s rule below.
 */
class StoreVehicleAllocationRequest extends FormRequest
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
            'tenant_id' => ['required', 'integer', ...$this->tenantRule()],

            // `exists` is safe for a vehicle in a way it is not for a
            // tenant: the fleet belongs to the platform (ADR-0005) and
            // `vehicles.view` is seeded to every system role, so a caller
            // who can reach this endpoint can already list every vehicle.
            // Nothing is disclosed by confirming one exists.
            'vehicle_id' => ['required', 'integer', Rule::exists('vehicles', 'id')->whereNull('deleted_at')],

            'starts_on' => ['required', 'date'],
            // Equal is allowed: a one-day hire is a real contract, and
            // `scopeInForceOn` already treats a period's last day as one of
            // its days.
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],

            'exclusive' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * The validated payload in the shape `AllocationService` accepts.
     *
     * The normalisation is real rather than a cast to quiet the analyser: a
     * JSON body yields integers but a form-encoded one yields strings, and
     * the service's contract is integers. Doing it here keeps the boundary
     * conversion at the boundary.
     *
     * @return array{vehicle_id: int, tenant_id: int, starts_on: string, ends_on: string|null, exclusive: bool, notes: string|null}
     */
    public function allocation(): array
    {
        $endsOn = $this->validated('ends_on');
        $notes = $this->validated('notes');

        return [
            'vehicle_id' => (int) $this->validated('vehicle_id'),
            'tenant_id' => (int) $this->validated('tenant_id'),
            'starts_on' => (string) $this->validated('starts_on'),
            'ends_on' => $endsOn === null ? null : (string) $endsOn,
            'exclusive' => (bool) $this->validated('exclusive', false),
            'notes' => $notes === null ? null : (string) $notes,
        ];
    }

    /**
     * Who this contract may be *for*.
     *
     * Platform staff may name any client — they are Shanitah, and Shanitah
     * is the other party to every one of these contracts. `exists` is
     * therefore safe for them: they may already list every tenant.
     *
     * A client-level actor holding `allocations.manage` is not in any seeded
     * role, but roles are editable (ADR-0004), so it must still be answered.
     * They are restricted to their own tenant with `in`, deliberately rather
     * than `exists`: `in` cannot distinguish "another client's real id" from
     * "an invented id", and both produce the identical generic message. This
     * project has already shipped a validation rule that let any employee
     * enumerate the client list one id at a time, and ADR-0007's reporting
     * filter refuses for exactly this reason.
     *
     * @return array<int, mixed>
     */
    private function tenantRule(): array
    {
        $actor = $this->user();

        if ($actor instanceof User && $actor->isPlatformLevel()) {
            return [Rule::exists('tenants', 'id')];
        }

        // A non-`User` actor — a `Customer` since ADR-0013 — has no tenant,
        // so the allowed set is empty and every tenant_id is refused.
        // Allocating a vehicle to a contract is not a customer's act.
        return [Rule::in(array_filter([$actor instanceof User ? $actor->tenant_id : null]))];
    }
}
