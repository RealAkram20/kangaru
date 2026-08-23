<?php

namespace Modules\Clients\Services;

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\OperatorClient;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Access\AccessContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Modules\Clients\Models\Company;

/**
 * Onboarding a corporate client (ADR-0060, ADR-0062).
 *
 * ## What this replaces
 *
 * `CompanyService::create()` took a `tenant_id` the caller already had, wrote
 * no contract and created no login. It produced a company profile attached to
 * a tenant, served by no fleet, that nobody at the client could sign into.
 * That is a row, not an onboarding, and it is why this class exists rather
 * than a few more lines there.
 *
 * ## One transaction, four rows, and no half-state
 *
 * A tenant, a company, a contract and the client's first administrator are
 * created together or not at all. Each of the four failure modes is worse than
 * the error the transaction throws instead:
 *
 * - a tenant with no company is a client with no name;
 * - a company with no contract is a client **nobody serves** — they cannot
 *   book, and nothing prompts anybody to notice;
 * - a client with no administrator is an account nobody can sign into, which
 *   is the same shape as ADR-0059 §5's fleet with nobody to act as;
 * - and a contract with no client is a foreign key waiting to fail.
 *
 * ## Who may do it, and which fleet takes the contract
 *
 * Both a fleet's Super Admin and head office's (ADR-0062 §3). A fleet's own
 * onboarding takes its own contract — it is the only fleet they could mean.
 * **Head office must name the fleet**, because a client with no fleet has
 * nobody to run its trips; the request enforces it rather than defaulting,
 * since a default here would be head office silently choosing somebody's
 * supplier.
 */
class ClientOnboardingService
{
    /**
     * Path A: nobody holds this registration number, so the client is new.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function onboard(array $attributes, int $operatorId): Company
    {
        return DB::transaction(function () use ($attributes, $operatorId) {
            $tenant = Tenant::create([
                'name' => $attributes['trading_name'] ?? $attributes['legal_name'],
                'slug' => $this->slugFor($attributes['legal_name']),
                'status' => 'active',
            ]);

            $company = new Company([
                ...$attributes,
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);
            $company->saveQuietly();

            OperatorClient::create([
                'operator_id' => $operatorId,
                'tenant_id' => $tenant->id,
                'status' => OperatorClient::ACTIVE,
                'started_on' => now()->toDateString(),
                'billing_email' => $attributes['billing_email'] ?? null,
                'credit_limit_minor' => $attributes['credit_limit_minor'] ?? null,
            ]);

            $this->firstAdministrator($tenant, $attributes);

            return $company;
        });
    }

    /**
     * Path B: somebody already holds this number, so the fleet may only ask.
     *
     * **This grants no read.** It writes a `requested` row and returns it, and
     * the caller must not turn that row into a lookup — the client's name,
     * status and existence beyond the boolean the fleet already had are all
     * still withheld until the client answers (ADR-0060 §4).
     *
     * Idempotent on purpose: a fleet clicking twice should not queue two
     * requests for the client to answer, and a fleet that has already been
     * refused should not be able to re-ask by reloading the form.
     */
    public function requestContract(string $registrationNumber, int $operatorId): OperatorClient
    {
        $tenantId = Company::withoutGlobalScopes()
            ->where('registration_number', $registrationNumber)
            ->value('tenant_id');

        // The caller checked with `/clients/lookup` first, so this is a race,
        // not a mistake — and the answer is still a boolean-shaped refusal
        // rather than "no such client", which would confirm the number is free.
        abort_if($tenantId === null, 404);

        return OperatorClient::firstOrCreate(
            ['operator_id' => $operatorId, 'tenant_id' => $tenantId],
            ['status' => OperatorClient::REQUESTED],
        );
    }

    /**
     * The client answers. Theirs to grant, and nobody else's — not Kangaru's,
     * and not the incumbent fleet's (ADR-0060 §5).
     */
    public function approve(OperatorClient $contract): OperatorClient
    {
        $contract->update([
            'status' => OperatorClient::ACTIVE,
            'started_on' => now()->toDateString(),
        ]);

        return $contract;
    }

    /**
     * A contract ends without ending the client (ADR-0060 §7). The row stays:
     * the trips and invoices it explains are still the client's history.
     */
    public function end(OperatorClient $contract): OperatorClient
    {
        $contract->update([
            'status' => OperatorClient::ENDED,
            'ended_on' => now()->toDateString(),
        ]);

        return $contract;
    }

    /**
     * The account the client signs in with, invited rather than given a
     * password.
     *
     * Nobody at the fleet chooses the client's credentials — the same line
     * `Modules/Administration` draws for staff and ADR-0018 draws for a
     * walk-in customer. A random password nobody is told is not a secret
     * anybody has to keep; the invitation is how they get in.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function firstAdministrator(Tenant $tenant, array $attributes): User
    {
        return app(AccessContext::class)->during(
            fn (AccessContext $context) => $context->bindClient($tenant->id),
            fn () => User::create([
                'tenant_id' => $tenant->id,
                'operator_id' => null,
                'access_level' => AccessLevel::CLIENT,
                'role' => UserRole::CORPORATE_ADMIN,
                'status' => UserStatus::ACTIVE,
                'name' => $attributes['admin_name'],
                'email' => $attributes['admin_email'],
                'password' => Str::password(32),
            ]),
        );
    }

    private function slugFor(string $legalName): string
    {
        $base = Str::slug($legalName) ?: 'client';
        $slug = $base;
        $n = 1;

        // Two clients may legitimately share a trading name — the registration
        // number is what tells them apart (ADR-0060 §1), not this.
        while (Tenant::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.++$n;
        }

        return $slug;
    }
}
