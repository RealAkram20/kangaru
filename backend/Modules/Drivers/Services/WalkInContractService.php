<?php

namespace Modules\Drivers\Services;

use Illuminate\Validation\ValidationException;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverWalkInContract;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\DriverEventNotification;

/**
 * The three answers a walk-in contract needs (ADR-0055 §5, `K8`).
 *
 * ## The rule this class exists to hold
 *
 * **No party may perform another's step.** The driver asks; their fleet
 * consents or refuses; Kangaru approves or refuses. Each transition below
 * checks the state it is coming *from*, so an out-of-order call is a 422 and
 * not a silent overwrite — and the policy separately decides *who* may call
 * it. Two gates on the same door, because they answer different questions: the
 * policy asks *are you the right party*, this asks *is it your turn*.
 *
 * If a driver could reach the approval, every driver on the platform is
 * contracted the moment they ask. That is the one that would collapse the
 * feature, and it is why `approve()` refuses anything not already consented
 * rather than trusting the caller to have checked.
 *
 * ## The waiver, and why it needs no column
 *
 * A driver who owns their vehicle has no fleet to ask (ADR-0048 §7), so their
 * request enters at `AWAITING_KANGARU` with `operator_id` null. ADR-0055 §5
 * waives fleet consent for exactly that case, and `drivers.owns_vehicle`
 * already says it — a second column would be the same fact recorded twice, and
 * the two would eventually disagree.
 */
class WalkInContractService
{
    /**
     * The driver asks to take walk-in work.
     *
     * Idempotent on the driver, matching `operator_client`'s shape for a fleet
     * asking twice: a driver clicking again does not queue a second request
     * for their fleet to answer. A refused driver may ask again, and the row
     * is reused — which is why `driver_id` is unique rather than a history
     * table. The history that matters is the audit log.
     */
    public function request(Driver $driver): DriverWalkInContract
    {
        $existing = DriverWalkInContract::query()->where('driver_id', $driver->id)->first();

        if ($existing !== null && $existing->status !== DriverWalkInContract::REFUSED) {
            return $existing;
        }

        // The waiver, expressed once. A driver-partner's request skips the
        // consent step because there is nobody to give it, not because the
        // step is optional.
        $ownsVehicle = (bool) $driver->owns_vehicle;

        $attributes = [
            'operator_id' => $ownsVehicle ? null : $driver->operator_id,
            'status' => $ownsVehicle
                ? DriverWalkInContract::AWAITING_KANGARU
                : DriverWalkInContract::REQUESTED,
            'fleet_answered_at' => $ownsVehicle ? now() : null,
            'kangaru_answered_at' => null,
            'refused_reason' => null,
        ];

        if ($existing !== null) {
            $existing->update($attributes);

            return $existing;
        }

        return DriverWalkInContract::create(['driver_id' => $driver->id, ...$attributes]);
    }

    /** The fleet agrees to let its driver take Kangaru's walk-in work. */
    public function consent(DriverWalkInContract $contract): DriverWalkInContract
    {
        $this->requireStatus($contract, DriverWalkInContract::REQUESTED, 'consent to');

        $contract->update([
            'status' => DriverWalkInContract::AWAITING_KANGARU,
            'fleet_answered_at' => now(),
        ]);

        return $contract;
    }

    /**
     * Kangaru accepts the driver into the walk-in economy.
     *
     * **Refuses anything not already consented.** This is the step that would
     * collapse the feature if it could be reached early: a driver who could
     * call it would be contracted the moment they asked, and their fleet would
     * never have been consulted at all.
     */
    public function approve(DriverWalkInContract $contract): DriverWalkInContract
    {
        $this->requireStatus($contract, DriverWalkInContract::AWAITING_KANGARU, 'approve');

        $contract->update([
            'status' => DriverWalkInContract::ACTIVE,
            'kangaru_answered_at' => now(),
        ]);

        // The driver asked for this, so they are the one who has to hear the
        // answer. Three parties touch this chain and only one of them is
        // waiting on it.
        $contract->driver?->user?->notify(
            new DriverEventNotification(NotificationType::DRIVER_WALK_IN_CONTRACT_APPROVED),
        );

        return $contract;
    }

    /**
     * Either answering party says no.
     *
     * One method rather than two, because the transition is the same and only
     * the timestamp differs — and which timestamp is decided by the state the
     * contract is in, not by the caller. A fleet cannot stamp
     * `kangaru_answered_at` by calling the wrong one.
     */
    public function refuse(DriverWalkInContract $contract, ?string $reason = null): DriverWalkInContract
    {
        if (! in_array($contract->status, [DriverWalkInContract::REQUESTED, DriverWalkInContract::AWAITING_KANGARU], true)) {
            throw ValidationException::withMessages([
                'status' => ['This request has already been answered.'],
            ]);
        }

        $contract->update([
            'status' => DriverWalkInContract::REFUSED,
            'refused_reason' => $reason,
            ...($contract->status === DriverWalkInContract::REQUESTED
                ? ['fleet_answered_at' => now()]
                : ['kangaru_answered_at' => now()]),
        ]);

        // Carrying the refusing party's words where they gave any. A refusal
        // with nothing after it reads as arbitrary, and this one can come from
        // either the fleet or head office.
        $contract->driver?->user?->notify(new DriverEventNotification(
            NotificationType::DRIVER_WALK_IN_CONTRACT_REFUSED,
            reason: $reason,
        ));

        return $contract;
    }

    /**
     * A live contract ends. The driver stops being offered walk-in work and
     * keeps every trip they already ran — the same shape as a fleet leaving a
     * client (ADR-0060 §7): the history is theirs.
     */
    public function end(DriverWalkInContract $contract): DriverWalkInContract
    {
        $this->requireStatus($contract, DriverWalkInContract::ACTIVE, 'end');

        $contract->update([
            'status' => DriverWalkInContract::REFUSED,
            'kangaru_answered_at' => now(),
        ]);

        return $contract;
    }

    /**
     * *Is it your turn* — separate from the policy's *are you the right
     * party*, because an out-of-order call by the correct party is still
     * wrong, and a silent overwrite is how a fleet's refusal becomes an
     * approval.
     */
    private function requireStatus(DriverWalkInContract $contract, string $expected, string $verb): void
    {
        if ($contract->status === $expected) {
            return;
        }

        throw ValidationException::withMessages([
            'status' => [sprintf('This request is %s, so it cannot be %s now.', $contract->status, $verb)],
        ]);
    }
}
