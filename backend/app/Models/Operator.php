<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;
use RuntimeException;

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
 * @property int $plan_id
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

    /**
     * No fleet exists without a plan (ADR-0058 §1).
     *
     * **On the model rather than in `OperatorService`, and that placement is
     * the whole point.** The service is one creation path; a seeder, a
     * console command, a future import and `Operator::create()` in a fixture
     * are others, and every one of them would otherwise be a way to make an
     * unpriced fleet. That is the same lesson `access_level` learned the hard
     * way — an invariant a caller has to remember is an invariant that
     * eventually ships broken.
     *
     * It **throws rather than defaulting to free** when nothing is flagged
     * default. ADR-0058 §1 is explicit: an unpriced fleet is a configuration
     * error, and it should say so at creation rather than be discovered at
     * the first billing run months later. Falling back to free would be
     * giving something away silently, which is the failure direction this
     * codebase keeps refusing.
     */
    protected static function booted(): void
    {
        static::creating(function (self $operator): void {
            // `getAttribute` rather than `$operator->plan_id`: the property
            // docblock describes a **saved** row, where the column is not
            // null, and this hook runs before there is one. Reading it
            // through the declared property makes the check look like dead
            // code to a static analyser, and it would be — after the save.
            if ($operator->getAttribute('plan_id') !== null) {
                return;
            }

            $plan = Plan::default();

            if (! $plan instanceof Plan) {
                throw new RuntimeException(
                    'No plan is flagged as the default, so a fleet cannot be priced. '
                    .'Flag one in `plans` before creating an operator (ADR-0058 §1).'
                );
            }

            $operator->plan_id = $plan->id;
        });
    }

    /** Shanitah, and the target of every F0 backfill. */
    public const SHANITAH = 1;

    protected $fillable = [
        'name',
        'slug',
        'status',
        'plan_id',
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
     * What this fleet pays to be on Kangaru (ADR-0058).
     *
     * Never null. A fleet with no plan is a configuration error that
     * `OperatorService` refuses at creation, not a state to be rendered.
     *
     * @return BelongsTo<Plan, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
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
