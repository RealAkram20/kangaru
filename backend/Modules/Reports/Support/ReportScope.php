<?php

namespace Modules\Reports\Support;

use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\ClientOptions;
use App\Support\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Whose figures a report is about (ADR-0007).
 *
 * ADR-0006 gave platform staff cross-tenant reads on *rows* — a booking is
 * a booking whichever client raised it, and a tenant column says which.
 * Reports are **aggregates**, and an aggregate that quietly spans clients
 * is not a wider report, it is a different number. So the scope of a report
 * is resolved once, explicitly, and then carried: to the query that builds
 * it, to the response that states it, and onto the `report_exports` row so
 * a file produced ten minutes later is about the same thing the request
 * asked for.
 *
 * Two shapes, and exactly two:
 *
 * - **one tenant** — a client's own report, or a platform user's report
 *   filtered to a named client (`?tenant_id=`);
 * - **all clients** — the platform-wide aggregate, which ADR-0007 permits
 *   for the driver and vehicle reports because those total a fleet that is
 *   genuinely Shanitah's (ADR-0005), and for the trip report when a
 *   platform user asks for no particular client.
 *
 * There is deliberately no third "whatever is bound" shape. Leaving the
 * scope implicit is what produced four blank reports for the Super Admin:
 * `TenantScope` fails closed, so an unstated scope is not a wide report,
 * it is an empty one.
 *
 * ## Why this applies the predicate itself
 *
 * `apply()` is the only place a report's tenant predicate is written, and
 * both shapes drop the global scope — the one-tenant shape then re-adds the
 * filter by hand. That looks like more risk than letting `TenantScope` do
 * it, and it is less, for one reason: **a repository that forgets to call
 * `apply()` still has the global scope on it.** A client sees their own
 * rows and a platform user sees nothing. Forgetting fails closed and
 * visibly; it cannot leak.
 *
 * The risk that remains is resolving the wrong scope, which is why
 * resolution lives in exactly one place — {@see ReportScopeResolver} — and
 * is what the isolation tests assert.
 */
final class ReportScope
{
    private ?string $describedAs = null;

    private function __construct(
        public readonly ?int $tenantId,
        public readonly bool $spansAllClients,
    ) {}

    /** One client's figures. */
    public static function tenant(int $tenantId): self
    {
        return new self($tenantId, false);
    }

    /** Every client's figures, totalled — platform staff only. */
    public static function allClients(): self
    {
        return new self(null, true);
    }

    /**
     * Rebuilds the scope a `report_exports` row was created under.
     *
     * A null `tenant_id` on that table means "all clients" and nothing
     * else, because the column is only ever written from a resolved scope.
     * It is not "unknown" and it is not "not yet set" — the nullable column
     * follows the precedent `audit_logs` already sets for platform-level
     * rows.
     */
    public static function fromTenantId(?int $tenantId): self
    {
        return $tenantId === null ? self::allClients() : self::tenant($tenantId);
    }

    /**
     * Constrains a report query to this scope.
     *
     * Deliberately an Eloquent builder rather than the query-builder
     * contract: dropping a global scope is the whole operation, and only
     * Eloquent has global scopes. A repository reaching for
     * `DB::table('invoices')` cannot be scoped by this class at all, which
     * is the correct outcome — ADR-0001 forbids it outside repositories,
     * and in an aggregate it would not leak a stray row, it would leak a
     * bigger number.
     *
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @param  string  $table  qualifies `tenant_id`, which is ambiguous the
     *                         moment a report joins anything
     * @return Builder<TModel>
     */
    public function apply(Builder $query, string $table): Builder
    {
        // Both shapes opt out, so the predicate below is the whole truth
        // about which rows this report covers. Leaving the global scope on
        // for the single-tenant case would work, but then half the reports
        // would be scoped by something visible here and half by something
        // three layers away, and the difference would only show up when a
        // platform user ran one.
        $query->withoutGlobalScope(TenantScope::class);

        if (! $this->spansAllClients) {
            $query->where($table.'.tenant_id', $this->tenantId);
        }

        return $query;
    }

    /**
     * What the response and the exported file header say about whose
     * figures these are.
     *
     * ADR-0007 rule 5: "An exported PDF that does not name whose figures it
     * contains is the document that ends up in the wrong meeting."
     */
    public function label(): string
    {
        return $this->spansAllClients ? 'all_clients' : 'tenant';
    }

    /**
     * Whose figures these are, in words, for the header of an exported
     * document (ADR-0007 rule 5).
     *
     * Names the client rather than printing its id, because the whole
     * argument for the label is that "an exported PDF that does not name
     * whose figures it contains is the document that ends up in the wrong
     * meeting" — and "Client #3" is not a name anybody in that meeting can
     * check.
     *
     * Memoized: the XLSX and PDF writers ask for the summary cells once per
     * file, but `summaryCells()` is cheap enough to be called more than once
     * and a document header should not be a query per call. `Tenant` is not
     * itself tenant-scoped, so this needs no scope handling of its own.
     */
    public function describe(): string
    {
        if ($this->spansAllClients) {
            return 'All clients';
        }

        // `value()` rather than `find()`: a document header needs one
        // string, and hydrating a model to read one column of it is work
        // this does per export for no gain.
        $name = Tenant::query()->whereKey($this->tenantId)->value('name');

        // A deleted tenant must not make an export throw. The figures are
        // still that tenant's and the file still has to say so, even if all
        // it can say is the id.
        return $this->describedAs ??= is_string($name) && $name !== ''
            ? $name
            : "Client #{$this->tenantId}";
    }

    /**
     * The scope block every report response carries (ADR-0007 rule 5).
     *
     * Two fields, because two different questions are being asked and this
     * module needs both:
     *
     * - **`scope`** answers *is the reader a platform reader* — actor-based,
     *   `'platform' | 'tenant'`, exactly as `/bookings`, `/trips` and
     *   `/audit-logs` already answer it. It is what tells a UI to offer a
     *   client picker at all. Reports must not invent a fourth vocabulary
     *   for a question three endpoints already answer.
     * - **`covers`** answers *whose figures are these* — the thing rule 5 is
     *   actually about, and not derivable from `scope`, because a platform
     *   reader filtered to one client is a platform reader looking at one
     *   client's numbers.
     *
     * `covers` is the **same string the exported XLSX and PDF header
     * carries**, deliberately. This module's governing rule is that the
     * screen and the spreadsheet cannot disagree about a figure; whose
     * figures they are is the one that matters most.
     *
     * `filters.clients` follows `/bookings` and `/trips` so a picker holds
     * no list of its own, and is empty for a client's own user — who has
     * exactly one client and never had a choice to make.
     *
     * @return array{
     *     scope: string,
     *     covers: string,
     *     filters: array{clients: array<int, array{value: int, label: string}>}
     * }
     */
    public function metaFor(User $actor): array
    {
        return [
            'scope' => $actor->isPlatformLevel() ? 'platform' : 'tenant',
            'covers' => $this->describe(),
            'filters' => ['clients' => ClientOptions::forActor($actor)],
        ];
    }
}
