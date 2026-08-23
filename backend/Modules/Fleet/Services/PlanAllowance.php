<?php

namespace Modules\Fleet\Services;

use App\Models\Operator;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * What a fleet's plan lets it add (ADR-0058 §4).
 *
 * ## The rule, stated as the three prohibitions it is written as
 *
 * **A limit blocks adding. It never removes, disables or breaks what already
 * exists.** Each clause below is a mistake somebody will otherwise make, which
 * is why ADR-0058 spells them out rather than trusting the sentence:
 *
 * 1. **No retroactive deactivation.** A fleet on Free holding eleven drivers —
 *    through a downgrade, an imported roster, a lowered ceiling — keeps all
 *    eleven working. Their drivers accept jobs, their trips complete, their
 *    wallets settle. Exceeding a limit never sets a status on anything.
 * 2. **No silent enforcement deep in the stack.** The refusal happens here, in
 *    the create path, and nowhere else. A driver who cannot get a job because
 *    of their employer's billing is a support call that takes an hour to
 *    diagnose and reaches the wrong team twice on the way.
 * 3. **A downgrade below current usage is refused, naming the figures.** The
 *    office reduces first. The system does not choose which twenty-eight
 *    drivers to cut.
 *
 * ## Why this is a service and not a validation rule
 *
 * The same question is asked from three create paths that live in three
 * modules, and the answer needs the fleet, the plan and a count. A rule object
 * per resource would be three copies of "null means unlimited", which is the
 * one clause it would be most expensive to get inconsistent.
 *
 * ## Null is unlimited, and this is the only place that knows it
 *
 * A plan with no `driver_limit` has no ceiling. Handled once, here, so a
 * caller comparing `count >= $plan->driver_limit` against a null can never
 * happen — that comparison is true for every count in PHP, which would refuse
 * the first driver a grandfathered fleet ever hired.
 */
class PlanAllowance
{
    public const DRIVERS = 'drivers';

    public const VEHICLES = 'vehicles';

    public const STAFF = 'staff';

    /**
     * Whether this fleet may add one more of something.
     *
     * A fleet with no plan is a configuration error rather than an unlimited
     * one — ADR-0058 §1 refuses to let a fleet exist without a plan precisely
     * so this branch means "something is broken", and it fails **closed**.
     */
    public function allows(Operator $operator, string $resource): bool
    {
        $plan = $operator->plan;

        if ($plan === null) {
            return false;
        }

        $limit = $this->limitFor($plan, $resource);

        if ($limit === null) {
            return true;
        }

        return $this->countFor($operator, $resource) < $limit;
    }

    /**
     * The same question, answered with a 422 that names the plan and the
     * number rather than a bare refusal.
     *
     * Thrown from the create path, so the person adding a driver is told at
     * the moment they are adding one — which is the whole of prohibition 2.
     */
    public function require(Operator $operator, string $resource): void
    {
        if ($this->allows($operator, $resource)) {
            return;
        }

        $plan = $operator->plan;

        if ($plan === null) {
            throw ValidationException::withMessages([
                'plan' => ['This fleet has no plan, so nothing can be added to it. Ask Kangaru to set one.'],
            ]);
        }

        $limit = $this->limitFor($plan, $resource);

        throw ValidationException::withMessages([
            $resource => [sprintf(
                '%s allows %d %s, and this fleet has %d. Change the plan to add another.',
                $plan->name,
                $limit,
                $resource,
                $this->countFor($operator, $resource),
            )],
        ]);
    }

    /**
     * Whether a fleet could move to a plan, and what stops it (ADR-0058 §4).
     *
     * Returns the resources that would be over the new plan's ceiling, each
     * with its figures — so the refusal can say *"Free allows 10 drivers; this
     * fleet has 38"* rather than "cannot downgrade".
     *
     * **Moving to a smaller plan is refused, not silently enforced.** The
     * alternative is a switch that quietly takes twenty-eight drivers out of
     * service, and nobody would connect that to a plan change made in a
     * different screen on a different day.
     *
     * @return array<string, array{limit: int, current: int}>
     */
    public function blockers(Operator $operator, Plan $plan): array
    {
        $blockers = [];

        foreach ([self::DRIVERS, self::VEHICLES, self::STAFF] as $resource) {
            $limit = $this->limitFor($plan, $resource);

            if ($limit === null) {
                continue;
            }

            $current = $this->countFor($operator, $resource);

            if ($current > $limit) {
                $blockers[$resource] = ['limit' => $limit, 'current' => $current];
            }
        }

        return $blockers;
    }

    private function limitFor(Plan $plan, string $resource): ?int
    {
        return match ($resource) {
            self::DRIVERS => $plan->driver_limit,
            self::VEHICLES => $plan->vehicle_limit,
            self::STAFF => $plan->staff_limit,
            default => null,
        };
    }

    /**
     * What the fleet holds now.
     *
     * Counted rather than cached. A stale count is a limit that refuses a
     * fleet with room or admits one without, and the query is a single
     * indexed `COUNT` on a column every one of these tables already has.
     */
    private function countFor(Operator $operator, string $resource): int
    {
        return match ($resource) {
            self::DRIVERS => Driver::withoutGlobalScopes()->where('operator_id', $operator->id)->count(),
            self::VEHICLES => Vehicle::withoutGlobalScopes()->where('operator_id', $operator->id)->count(),
            // Staff, not drivers: a driver's account is a fleet account too,
            // and counting them here would charge a fleet twice for the same
            // person under two ceilings.
            self::STAFF => User::query()
                ->where('operator_id', $operator->id)
                ->where('role', '!=', 'driver')
                ->count(),
            default => 0,
        };
    }
}
