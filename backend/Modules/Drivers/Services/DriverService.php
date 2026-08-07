<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\StoreDriverRequest;
use Modules\Drivers\Requests\UpdateDriverRequest;

/**
 * Plain Eloquent CRUD — no repository. Simple single-model CRUD doesn't
 * earn a repository per ADR-0002.
 *
 * No allTenants() platform-level bypass: drivers are always created by an
 * already tenant-scoped user, so BelongsToTenant auto-fills tenant_id
 * from TenantContext normally.
 */
class DriverService
{
    public function __construct(private readonly DriverAccountService $accounts) {}

    public function list(User $user): Collection
    {
        // Eager loaded because DriverResource now reports whether each
        // driver can sign in; without this the list is one query per row
        // (AGENTS.md — prevent N+1).
        return Driver::query()->with('user')->get();
    }

    public function create(StoreDriverRequest $request): Driver
    {
        return Driver::create($request->validated());
    }

    public function update(Driver $driver, UpdateDriverRequest $request): Driver
    {
        $driver->update($request->validated());

        // A driver suspended on the fleet screen who can still sign in is
        // suspended on paper only: `TripPolicy::transition` asks whether
        // the trip's driver is the caller, never whether that driver is
        // allowed to drive today. ADR-0016 §5 — the account follows the
        // profile down, and does not follow it back up.
        if (($request->validated()['status'] ?? null) === 'suspended') {
            $this->accounts->suspendAccountFor($driver);
        }

        return $driver;
    }

    /**
     * The account is detached before the profile goes, for two reasons and
     * both of them bite.
     *
     * A soft delete leaves the row — and its `user_id` — in the table, so
     * the unique index added by ADR-0016 would go on reserving that account
     * against a profile nobody can see. Re-hiring the same driver would
     * then fail with a conflict naming a driver who appears not to exist.
     *
     * And a deleted driver whose token is still live keeps passing
     * `TripPolicy::transition` for any trip still pointing at them.
     */
    public function delete(Driver $driver): void
    {
        $this->accounts->close($driver);

        $driver->delete();
    }
}
