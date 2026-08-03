<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Billing\Models\Invoice;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Support\ReportScope;
use Modules\Reports\Support\ReportScopeResolver;
use Tests\Support\BillingFixtures;

/**
 * ADR-0007: what a report is about when the person running it belongs to no
 * client.
 *
 * This is the **third obligation** ADR-0007 adds to the mandatory isolation
 * suite, alongside ADR-0001's original (a client sees only their own) and
 * ADR-0006's mirror (a platform user with no permission on a surface sees
 * nothing of it). It has two halves and they fail in opposite directions:
 *
 * - a platform actor's report, filtered to one client, must contain **only**
 *   that client — otherwise the filter is decoration;
 * - a client's user supplying `tenant_id` must be **refused**, not obeyed —
 *   otherwise ADR-0007 has invented a cross-tenant read where none existed.
 *
 * The second is the new escalation surface this decision creates, and it is
 * the reason the file exists. Everything else here would be a feature test.
 *
 * Both guards are proved rather than asserted: see the two `it()` blocks
 * marked "guard" and the note above each on what to delete to watch it go
 * red. That is AGENTS.md's rule for a safety-critical test, and this
 * project has already shipped a race test that passed vacuously.
 */

/**
 * Two independent clients, each with a completed trip and an issued
 * invoice, plus Shanitah's own Super Admin and Finance officer.
 *
 * The two clients' distances are far apart on purpose — 42 km against
 * 700 km. A leak in an aggregate is not a stray row, it is a bigger number,
 * and two figures that could be confused for rounding would prove nothing.
 *
 * @return array<string, mixed>
 */
function twoClientsAndPlatformReaders(): array
{
    $build = function (string $key, int $odometerEnd) {
        $fixture = BillingFixtures::tenantWithRateCard();

        $trip = BillingFixtures::completedTrip(
            $fixture['tenant'],
            $fixture['dispatcher'],
            $fixture['vehicle'],
            $fixture['driver'],
            odometerStart: 15_000,
            odometerEnd: $odometerEnd,
        );

        test()->withHeader('Idempotency-Key', "idem-scope-{$key}")
            ->actingAs($fixture['finance'], 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/invoice")
            ->assertStatus(201);

        return [
            ...$fixture,
            'trip' => $trip->refresh(),
            'invoice' => Invoice::allTenants()->where('trip_id', $trip->id)->firstOrFail(),
            // A client-side reader who holds `reports.view` but is not
            // platform staff.
            'manager' => User::factory()->create([
                'tenant_id' => $fixture['tenant']->id,
                'role' => UserRole::OPERATIONS_MANAGER,
            ]),
        ];
    };

    $a = $build('a', 15_042);
    $b = $build('b', 15_700);

    $superadmin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $finance = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);

    // The fixtures bound a tenant by hand. Clear it, so these requests start
    // where a real platform login starts: nothing bound, because the actor
    // belongs to nowhere.
    app(TenantContext::class)->set(null);

    return ['a' => $a, 'b' => $b, 'superadmin' => $superadmin, 'platformFinance' => $finance];
}

// ── The escalation surface: a client may not choose a tenant ─────────────

/**
 * GUARD. To watch this fail, make `ReportScopeResolver::accepts()` return
 * true for a client — drop the `$actor->isPlatformLevel() &&`. `tenant_id`
 * joins the whitelist, the 422 becomes a 200, and the last two expectations
 * below start reading the other client's trips.
 */
it('refuses a client user who supplies tenant_id on the trip report', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($a['manager'], 'sanctum')
        ->getJson('/api/v1/reports/trips?tenant_id='.$b['tenant']->id)
        ->assertStatus(422);

    expect($response->json('code'))->toBe('VALIDATION_FAILED');
    expect($response->json('errors'))->toHaveKey('tenant_id');

    // And nothing leaked on the way to being refused.
    expect($response->json('data'))->toBeNull();
});

it('refuses a client user who supplies tenant_id on the financial report', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $this->actingAs($a['manager'], 'sanctum')
        ->getJson('/api/v1/reports/financial?tenant_id='.$b['tenant']->id)
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED')
        ->assertJsonStructure(['errors' => ['tenant_id']]);
});

/**
 * The export path has no whitelist of its own — it only rejects filters
 * belonging to *other* reports — so without an explicit check `tenant_id`
 * would be accepted from a client and silently dropped. A file that ignores
 * a filter its own request records is worse than one that refuses it.
 */
it('refuses a client user who supplies tenant_id when requesting an export', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $this->actingAs($a['manager'], 'sanctum')
        ->postJson('/api/v1/reports/exports', [
            'report' => 'trips',
            'format' => 'csv',
            'tenant_id' => $b['tenant']->id,
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['tenant_id']]);
});

/**
 * The enumeration guard. This project has already shipped a validation rule
 * that let any employee walk the platform's client list one id at a time,
 * and an `exists:tenants,id` rule is exactly how that happens again.
 *
 * A client must not be able to tell a real tenant id from an invented one
 * by the shape of the refusal, so both must produce the identical error.
 */
it('gives a client the same refusal for a real tenant id as for an invented one', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $real = $this->actingAs($a['manager'], 'sanctum')
        ->getJson('/api/v1/reports/trips?tenant_id='.$b['tenant']->id)
        ->assertStatus(422)
        ->json('errors');

    $invented = $this->actingAs($a['manager'], 'sanctum')
        ->getJson('/api/v1/reports/trips?tenant_id=987654')
        ->assertStatus(422)
        ->json('errors');

    expect($real)->toEqual($invented);
});

/**
 * GUARD, second layer. Validation refuses the parameter before the resolver
 * ever sees it, so this asserts the resolver independently: even handed a
 * tenant id directly, a client's scope is their own.
 *
 * To watch it fail, change the client branch of `ReportScopeResolver::resolve()`
 * to `ReportScope::tenant($requestedTenantId ?? (int) $actor->tenant_id)`.
 * Defence in depth is only defence if each layer is tested on its own.
 */
it('resolves a client to their own tenant even when handed another one', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $scope = app(ReportScopeResolver::class)
        ->resolve(ReportType::TRIPS, $a['manager'], $b['tenant']->id);

    expect($scope->tenantId)->toBe($a['tenant']->id);
    expect($scope->spansAllClients)->toBeFalse();
});

// ── Platform staff: filtered means only that client ──────────────────────

it('gives a platform reader one client\'s trips when filtered to them', function () {
    ['a' => $a, 'b' => $b, 'superadmin' => $superadmin] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($superadmin, 'sanctum')
        ->getJson('/api/v1/reports/trips?tenant_id='.$a['tenant']->id)
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('trip_id')->all();

    expect($ids)->toContain($a['trip']->id);
    expect($ids)->not->toContain($b['trip']->id);

    // The totals matter more than the rows: this is where a leak hides.
    expect((float) $response->json('meta.summary.distance_km'))->toBe(42.0);
    expect($response->json('meta.scope'))->toBe([
        'type' => 'tenant',
        'tenant_id' => $a['tenant']->id,
    ]);
});

it('gives a platform reader every client\'s trips when unfiltered', function () {
    ['a' => $a, 'b' => $b, 'superadmin' => $superadmin] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($superadmin, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('trip_id')->all();

    expect($ids)->toContain($a['trip']->id);
    expect($ids)->toContain($b['trip']->id);

    // 42 + 700. The label is the point: `records_incomplete` is a
    // per-client compliance figure in PROJECT.md, and this response has to
    // say it is now a platform average rather than leave that to be
    // inferred.
    expect((float) $response->json('meta.summary.distance_km'))->toBe(742.0);
    expect($response->json('meta.scope.type'))->toBe('all_clients');
    expect($response->json('meta.scope.tenant_id'))->toBeNull();
});

// ── The financial report refuses rather than totals across clients ───────

/**
 * ADR-0007 rule 2, and the sharp edge of the whole decision.
 */
it('refuses a platform reader the financial report with no client named', function () {
    ['platformFinance' => $finance] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial')
        ->assertStatus(422);

    expect($response->json('code'))->toBe('VALIDATION_FAILED');
    expect($response->json('errors'))->toHaveKey('tenant_id');

    // Emphatically not a total. Before this decision the same request was a
    // 200 with zero rows, which was at least honest; the failure this test
    // guards against is the other repair — spanning every client and
    // calling the sum "Total invoiced".
    expect($response->json('data'))->toBeNull();
});

it('gives a platform finance officer one client\'s money when they name the client', function () {
    ['a' => $a, 'b' => $b, 'platformFinance' => $finance] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?tenant_id='.$a['tenant']->id)
        ->assertOk();

    expect($response->json('meta.scope'))->toBe([
        'type' => 'tenant',
        'tenant_id' => $a['tenant']->id,
    ]);

    $invoiced = (int) $response->json('meta.summary.invoiced_minor');
    $aTotal = $a['invoice']->total()->getMinorAmount()->toInt();
    $bTotal = $b['invoice']->total()->getMinorAmount()->toInt();

    expect($invoiced)->toBe($aTotal);

    // Stated separately rather than relying on the equality above: the two
    // clients' invoices could in principle come to the same figure, and an
    // assertion that only says "equals A" would then pass on the summed
    // number too. Both fixtures drive different distances precisely so this
    // cannot happen, and the guard says so out loud.
    expect($bTotal)->toBeGreaterThan(0);
    expect($invoiced)->not->toBe($aTotal + $bTotal);
});

// ── The fleet reports span, because the fleet is Shanitah's ──────────────

it('spans every client on the driver and vehicle reports for platform staff', function () {
    ['superadmin' => $superadmin] = twoClientsAndPlatformReaders();

    foreach (['drivers', 'vehicles'] as $report) {
        $response = $this->actingAs($superadmin, 'sanctum')
            ->getJson("/api/v1/reports/{$report}")
            ->assertOk();

        // Two clients, one driver and one vehicle each, one trip apiece —
        // and since ADR-0005 they are one pool, so a platform view of it is
        // both rows rather than either.
        expect($response->json('data'))->toHaveCount(2);
        expect((float) $response->json('meta.summary.distance_km'))->toBe(742.0);
        expect($response->json('meta.scope.type'))->toBe('all_clients');
    }
});

it('refuses tenant_id on the fleet reports even for platform staff', function () {
    ['a' => $a, 'superadmin' => $superadmin] = twoClientsAndPlatformReaders();

    // Not a filter these reports accept from anybody: they aggregate a
    // pooled fleet, and per-client utilisation of a shared vehicle answers
    // a worse question than the one being asked (ADR-0007 rule 3).
    $this->actingAs($superadmin, 'sanctum')
        ->getJson('/api/v1/reports/drivers?tenant_id='.$a['tenant']->id)
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['tenant_id']]);
});

// ── A client's own experience is unchanged ───────────────────────────────

it('leaves a client\'s own reports exactly as they were', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformReaders();

    $response = $this->actingAs($a['manager'], 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('trip_id')->all();

    expect($ids)->toContain($a['trip']->id);
    expect($ids)->not->toContain($b['trip']->id);
    expect((float) $response->json('meta.summary.distance_km'))->toBe(42.0);

    // Their scope is stated too, and names their own tenant — a client
    // reading `meta.scope` must not find it absent just because they had no
    // choice in it.
    expect($response->json('meta.scope'))->toBe([
        'type' => 'tenant',
        'tenant_id' => $a['tenant']->id,
    ]);
});

it('does not require a client to name a tenant on the financial report', function () {
    ['a' => $a] = twoClientsAndPlatformReaders();

    // The requirement is on platform staff only. A client has one tenant
    // and is never asked to choose it.
    $this->actingAs($a['finance'], 'sanctum')
        ->getJson('/api/v1/reports/financial')
        ->assertOk()
        ->assertJsonPath('meta.scope.tenant_id', $a['tenant']->id);
});

// ── ReportScope itself ───────────────────────────────────────────────────

it('rebuilds a platform scope from a null tenant id and a client scope from a real one', function () {
    expect(ReportScope::fromTenantId(null)->spansAllClients)->toBeTrue();
    expect(ReportScope::fromTenantId(null)->tenantId)->toBeNull();
    expect(ReportScope::fromTenantId(7)->spansAllClients)->toBeFalse();
    expect(ReportScope::fromTenantId(7)->tenantId)->toBe(7);
});
