<?php

namespace Modules\Reports\Requests\Concerns;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;
use Modules\Reports\Support\ReportScope;
use Modules\Reports\Support\ReportScopeResolver;

/**
 * The `tenant_id` filter ADR-0007 adds, shared by the three requests that
 * can carry it.
 *
 * The report requests are deliberately *not* one class — a shared whitelist
 * would be the union of every report's filters, and each report would then
 * silently ignore the ones that are not its own. That reasoning is about
 * the filters that differ. `tenant_id` is the one filter whose handling
 * must be *identical* everywhere it appears, because it decides whose money
 * a report is about, so it is shared rather than copied three times.
 *
 * Requires the using class to expose `reportType()`.
 */
trait AcceptsTenantFilter
{
    /**
     * Added to the whitelist only for an actor who may use it, so a client
     * sending `tenant_id` falls through to the ordinary unknown-filter
     * error the request already raises.
     *
     * That is the whole client-side defence and it is deliberately dull: no
     * bespoke message, no "you may not filter by tenant", and above all no
     * existence check. This project has already shipped a validation rule
     * that let any employee enumerate the platform's client list one id at
     * a time; a client must not be able to tell a real tenant id from an
     * invented one by the shape of the error.
     *
     * @return array<int, string>
     */
    protected function tenantFilterKeys(): array
    {
        return $this->scopeResolver()->accepts($this->reportType(), $this->actor())
            ? ['tenant_id']
            : [];
    }

    /**
     * @return array<string, mixed>
     */
    protected function tenantFilterRules(): array
    {
        if (! $this->scopeResolver()->accepts($this->reportType(), $this->actor())) {
            // No rule at all rather than a rule that never passes: for a
            // client the key is already refused by the whitelist, and a
            // second error naming `tenant_id` would confirm the parameter
            // exists.
            return [];
        }

        return [
            'tenant_id' => [
                'sometimes',
                'integer',
                // Safe here in a way it would not be for a client: this
                // branch is platform staff only, and they may already list
                // every tenant.
                Rule::exists('tenants', 'id'),
            ],
        ];
    }

    /**
     * ADR-0007 rule 2 — the financial report refuses to total across
     * clients rather than doing it silently.
     */
    protected function validateTenantFilterRequired(Validator $validator): void
    {
        if (! $this->scopeResolver()->requires($this->reportType(), $this->actor())) {
            return;
        }

        if ($this->requestedTenantId() !== null) {
            return;
        }

        $validator->errors()->add('tenant_id', sprintf(
            'Choose the client this %s is for. A total across every client is a different figure '.
            'from any one client\'s, so it is not produced here.',
            strtolower($this->reportType()->label()),
        ));
    }

    /**
     * The mirror: `tenant_id` supplied by somebody who may not supply it.
     *
     * Only needed where the request has no whitelist of its own to catch
     * it. The two on-screen requests compare the query string against an
     * allowed-key list and already raise the canonical "not a filter this
     * report accepts", so calling this there would produce the same
     * complaint twice. `RequestExportRequest` has no such list — it only
     * rejects filters belonging to *other* reports — so without this an
     * export would accept `tenant_id` from a client and quietly ignore it,
     * which is the silence ADR-0007 refuses.
     */
    protected function validateTenantFilterAccepted(Validator $validator): void
    {
        if ($this->input('tenant_id') === null) {
            return;
        }

        if ($this->scopeResolver()->accepts($this->reportType(), $this->actor())) {
            return;
        }

        $validator->errors()->add(
            'tenant_id',
            "\"tenant_id\" is not a filter the {$this->reportType()->label()} accepts.",
        );
    }

    /**
     * Read from raw input rather than `validated()`, because
     * `withValidator()` runs while validation is still in progress and
     * `validated()` throws once anything has failed.
     */
    protected function requestedTenantId(): ?int
    {
        $value = $this->input('tenant_id', $this->query('tenant_id'));

        return is_numeric($value) ? (int) $value : null;
    }

    /**
     * The resolved scope for this request. Call only after validation.
     */
    public function reportScope(): ReportScope
    {
        return $this->scopeResolver()->resolve(
            $this->reportType(),
            $this->actor(),
            $this->requestedTenantId(),
        );
    }

    protected function actor(): User
    {
        $user = $this->user();

        // Every route carrying this trait sits behind `auth:sanctum`, so
        // this is narrowing the framework's `?Authenticatable`, not a
        // guard.
        abort_unless($user instanceof User, 401);

        return $user;
    }

    protected function scopeResolver(): ReportScopeResolver
    {
        return app(ReportScopeResolver::class);
    }
}
