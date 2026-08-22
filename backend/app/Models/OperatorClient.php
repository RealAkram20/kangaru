<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A fleet's contract with a corporate client (ADR-0055 §6).
 *
 * The record that makes *"one client, two or more fleets"* expressible. Before
 * it, `tenants` held the client and `operators` held the fleet and nothing
 * joined them, so the question had no answer to store.
 *
 * ## What it deliberately does not carry
 *
 * The client's **identity** — legal name, registration number, address — stays
 * on `tenants`/`companies`, because those are facts about the client rather
 * than about the relationship. A fleet editing them would be rewriting another
 * fleet's client, which is the write-side mirror of the read leak ADR-0001
 * calls the worst bug this platform can have.
 *
 * ## Null overrides mean "use the client's own value"
 *
 * `billing_email` and `credit_limit_minor` are nullable here and still present
 * on `companies`. Null is not missing data — it means this fleet bills the
 * client the way the client is billed generally. That is the same shape F1
 * gave reference data one package earlier: null means *inherit*, a value means
 * *override*.
 *
 * @property int $operator_id
 * @property int $tenant_id
 * @property string $status
 * @property string|null $billing_email
 * @property int|null $credit_limit_minor
 */
class OperatorClient extends Model
{
    /**
     * The pivot's own name. Laravel would guess `operator_clients`; the table
     * is singular because it is a pivot in the framework's own convention, and
     * saying so here is cheaper than renaming the table to suit a guess.
     */
    protected $table = 'operator_client';

    public const ACTIVE = 'active';

    /**
     * Set here as well as on the column, for the reason `UserFactory` records
     * about `status`: a database default applies **on insert**, so the
     * in-memory model a caller has just created carries null for it, and every
     * read of that instance sees a contract with no state. A model handed back
     * from `create()` should be indistinguishable from one loaded out of the
     * database.
     *
     * @var array<string, mixed>
     */
    protected $attributes = ['status' => self::ACTIVE];

    protected $fillable = [
        'operator_id',
        'tenant_id',
        'status',
        'started_on',
        'ended_on',
        'billing_email',
        'credit_limit_minor',
    ];

    protected function casts(): array
    {
        return [
            'started_on' => 'date',
            'ended_on' => 'date',
            'credit_limit_minor' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Operator, $this>
     */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(Tenant::class, 'tenant_id');
    }

    /**
     * The contracts a client may currently be served under.
     *
     * This is the question the fleet switcher asks on every page load — *which
     * fleets serve me* — and the one that decides what a client's console
     * shows. An ended contract stays on the record: its trips and invoices are
     * still the client's history, and hiding the fleet that ran them would
     * leave a year of work attributed to nobody.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeServing(Builder $query, int $tenantId): Builder
    {
        return $query->where('tenant_id', $tenantId)->where('status', self::ACTIVE);
    }
}
