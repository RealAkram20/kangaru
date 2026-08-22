<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * A fleet company — the outer axis of ADR-0055.
 *
 * Shanitah General Enterprises Ltd is row 1, inserted by the migration that
 * creates this table rather than by a seeder, because six backfills name that
 * id and `php artisan migrate` runs without seeders in production.
 *
 * ## The peer of `Tenant`, not its parent
 *
 * `Tenant` is the corporate client; this is the fleet that serves it. Neither
 * contains the other: a client may contract several fleets (ADR-0055 §6), so
 * `operator_id` cannot be derived from `tenant_id` and the two are independent
 * columns on every operational row. Shaped the same way as `Tenant` on purpose
 * — lean identity, with a richer business profile belonging beside it if one is
 * ever needed, exactly as ADR-0001 split `tenants` from `companies`.
 *
 * ## There is deliberately no way to create a second one
 *
 * No endpoint, no policy, no factory state, no seeder. Between F0 and F2 the
 * operational tables carry `operator_id` and nothing filters on it, so a second
 * fleet's dispatcher would read Shanitah's trips. The absence of a creation
 * path is the rail that holds until F2 closes that gap, and it is the reason
 * this model has no `$fillable` beyond the three descriptive columns — mass
 * assignment is not the risk, a second row is.
 *
 * @property int $id
 * @property string $name
 * @property string $slug
 * @property string $status
 */
class Operator extends Model
{
    /*
     * Deliberately no `HasFactory`.
     *
     * A factory is a way to create a second operator, and the docblock above
     * says F0 ships none — `Operator::factory()` in a fixture is exactly how
     * a second fleet arrives in a test that did not mean to summon one, and
     * from there into somebody's expectations about what the code supports.
     * `CrossFleetIsolationTest` builds its rival with `Operator::create()`,
     * where the intent is visible in the diff.
     *
     * Larastan's `missingType.generics` was what surfaced the question, and
     * the answer is to drop the trait rather than to write the factory it
     * was asking to be typed.
     */

    /** Shanitah, and the target of every F0 backfill. */
    public const SHANITAH = 1;

    protected $fillable = [
        'name',
        'slug',
        'status',
    ];

    /**
     * Staff and drivers both. A driver is a `users` row with
     * `access_level = 'fleet'` like a dispatcher is — the three demo drivers
     * being null-client accounts is what made ADR-0055 §4's hazard real.
     *
     * @return HasMany<User, $this>
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    /**
     * @return HasMany<Driver, $this>
     */
    public function drivers(): HasMany
    {
        return $this->hasMany(Driver::class);
    }

    /**
     * @return HasMany<Vehicle, $this>
     */
    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }

    /**
     * The corporate clients this fleet serves, and on what terms (ADR-0055 §6).
     *
     * Deliberately **not** `hasMany(Tenant::class)`. A client is not owned by a
     * fleet — it may contract several — so the relationship is a record in its
     * own right rather than a foreign key on the client. That distinction is
     * the whole reason this table exists, and expressing it as ownership here
     * would invite exactly the cross-fleet write the contract exists to
     * prevent: one fleet editing another fleet's client.
     *
     * @return HasMany<OperatorClient, $this>
     */
    public function contracts(): HasMany
    {
        return $this->hasMany(OperatorClient::class);
    }
}
