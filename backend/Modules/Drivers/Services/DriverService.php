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
    public function list(User $user): Collection
    {
        return Driver::all();
    }

    public function create(StoreDriverRequest $request): Driver
    {
        return Driver::create($request->validated());
    }

    public function update(Driver $driver, UpdateDriverRequest $request): Driver
    {
        $driver->update($request->validated());

        return $driver;
    }

    public function delete(Driver $driver): void
    {
        $driver->delete();
    }
}
