<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Billing\Models\Invoice;
use Modules\Bookings\Models\Booking;
use Modules\Trips\Models\Trip;
use Tests\Support\BillingFixtures;

/**
 * ADR-0006's half of the mandatory isolation suite.
 *
 * ADR-0001's existing tests prove a **client** sees only their own. This is
 * the mirror the ADR requires alongside them: that a **platform** user with
 * no permission on a surface sees nothing of it either.
 *
 * Both halves are needed and they fail differently. Without the first, one
 * client reads another's data. Without this one, `tenant_id` being null
 * quietly becomes a permission of its own — and the whole decision rests on
 * it not being one. ADR-0006's words: without these tests it "is a hole with
 * a name".
 *
 * The pair under test is deliberately a platform **Dispatcher** and a
 * platform **Finance officer**. Both belong to no tenant, so both read
 * across every client; only one of them holds `invoices.view`. If belonging
 * to no tenant ever started granting reach on its own, the dispatcher would
 * be reading a bank's revenue, and that is the exact bug this project has
 * already shipped once — a Dispatcher who could export a client's financial
 * report.
 */

/**
 * Two independent clients, each with a booking, a trip and an issued
 * invoice, plus Shanitah's own dispatch desk and Finance officer.
 *
 * @return array<string, mixed>
 */
function twoClientsAndPlatformStaff(): array
{
    $build = function (string $key) {
        $fixture = BillingFixtures::tenantWithRateCard();

        $trip = BillingFixtures::completedTrip(
            $fixture['tenant'], $fixture['dispatcher'], $fixture['vehicle'], $fixture['driver'],
        );

        test()->withHeader('Idempotency-Key', "idem-platform-{$key}")
            ->actingAs($fixture['finance'], 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/invoice")
            ->assertStatus(201);

        $booking = Booking::factory()->forTenant($fixture['tenant'])->create();

        return [
            ...$fixture,
            'trip' => $trip,
            'booking' => $booking,
            'invoice' => Invoice::allTenants()->where('trip_id', $trip->id)->firstOrFail(),
        ];
    };

    $clients = ['a' => $build('a'), 'b' => $build('b')];

    // Shanitah's employees: no tenant at all. Not "a tenant with special
    // powers" — the rejected alternative in ADR-0006 — simply no tenant.
    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
    $finance = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);

    // The seeders and fixtures above bound a tenant by hand. Clear it, so
    // these requests start from where a real platform login starts: nothing
    // bound, because the actor belongs to nowhere.
    app(TenantContext::class)->set(null);

    return [...$clients, 'dispatcher' => $dispatcher, 'finance' => $finance];
}

// ── What platform staff MAY reach ────────────────────────────────────────

it('shows a platform dispatcher every client\'s bookings in one queue', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    // The point of the decision: a matcher that can only see one client's
    // demand is not matching. Before ADR-0006 this list was empty.
    expect($ids)->toContain($a['booking']->id);
    expect($ids)->toContain($b['booking']->id);
});

it('shows a platform dispatcher every client\'s trips', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/trips')->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    expect($ids)->toContain($a['trip']->id);
    expect($ids)->toContain($b['trip']->id);
});

it('lets a platform dispatcher open a client\'s trip and its timeline by id', function () {
    ['a' => $a, 'dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    // Route-model binding is the other half of the listing, and it failed
    // separately: SubstituteBindings resolves through the global scope, so
    // every single-resource URL 404'd for an account with no tenant even
    // where the listing worked.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$a['trip']->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $a['trip']->id);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$a['trip']->id}/events")
        ->assertOk();
});

it('shows a platform finance officer every client\'s invoices', function () {
    ['a' => $a, 'b' => $b, 'finance' => $finance] = twoClientsAndPlatformStaff();

    $response = $this->actingAs($finance, 'sanctum')->getJson('/api/v1/invoices')->assertOk();

    $uuids = collect($response->json('data'))->pluck('uuid')->all();

    // Finance holds `invoices.view`, so the same mechanism that shows the
    // dispatcher nothing shows Finance all of it. That is the composition
    // working, not an exception to it.
    expect($uuids)->toContain($a['invoice']->uuid);
    expect($uuids)->toContain($b['invoice']->uuid);
});

// ── What platform staff MAY NOT reach — the mirror ───────────────────────

it('refuses a platform dispatcher the invoice listing', function () {
    ['dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    // Belonging to no tenant answers *whose* rows are in range. It must
    // never answer *what* the actor may see — that stays ADR-0004's
    // catalogue, and a Dispatcher does not hold `invoices.view`.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/invoices')
        ->assertStatus(403)
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('refuses a platform dispatcher a client\'s invoice by uuid', function () {
    ['a' => $a, 'dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    // 403 rather than 404 on purpose. AGENTS.md's "never 403 for another
    // tenant's resource" exists so one client cannot probe another's
    // identifiers; platform staff are not another client, and pretending
    // the invoice does not exist would misdescribe the refusal.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/invoices/{$a['invoice']->uuid}")
        ->assertStatus(403)
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('refuses a platform dispatcher a client\'s rate cards', function () {
    ['a' => $a, 'dispatcher' => $dispatcher] = twoClientsAndPlatformStaff();

    // Negotiated prices, which are the client's commercial terms.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/rate-cards')
        ->assertStatus(403);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/rate-cards/{$a['card']->id}")
        ->assertStatus(403);
});

// ── And the client half is unchanged ─────────────────────────────────────

it('still shows a client\'s own user only their own tenant\'s bookings and trips', function () {
    ['a' => $a, 'b' => $b] = twoClientsAndPlatformStaff();

    // ADR-0006 amends how the scope is *applied*, not the scope. A
    // regression here would mean the new opt-out leaked into the path it
    // was never meant to touch.
    $bookings = $this->actingAs($a['dispatcher'], 'sanctum')->getJson('/api/v1/bookings')->assertOk();
    $trips = $this->actingAs($a['dispatcher'], 'sanctum')->getJson('/api/v1/trips')->assertOk();

    expect(collect($bookings->json('data'))->pluck('id')->all())
        ->toContain($a['booking']->id)
        ->not->toContain($b['booking']->id);

    expect(collect($trips->json('data'))->pluck('id')->all())
        ->toContain($a['trip']->id)
        ->not->toContain($b['trip']->id);

    $this->actingAs($a['dispatcher'], 'sanctum')
        ->getJson("/api/v1/trips/{$b['trip']->id}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('keeps TenantScope failing closed when nothing is bound', function () {
    ['a' => $a] = twoClientsAndPlatformStaff();

    expect($a['trip']->exists)->toBeTrue();

    app(TenantContext::class)->set(null);

    // ADR-0006 Decision 1, and the reason the tempting one-line version of
    // this whole ADR was rejected. If a null context ever meant "see
    // everything", a job that forgot `app(TenantContext::class)->set($id)`
    // would silently read every client's rows instead of none — turning a
    // visible nothing into a silent everything, and turning a vacuous test
    // pass into a cross-tenant read.
    expect(Trip::count())->toBe(0);
    expect(Trip::find($a['trip']->id))->toBeNull();
    expect(Booking::count())->toBe(0);
    expect(Invoice::count())->toBe(0);

    // Still reachable when the read says out loud that it has no actor.
    expect(Trip::allTenants()->count())->toBeGreaterThan(0);
});

it('gives a platform account with no tenant no rows and no crash on an empty platform', function () {
    Tenant::factory()->create();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    app(TenantContext::class)->set(null);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/bookings')
        ->assertOk()
        ->assertJsonPath('data', []);
});
