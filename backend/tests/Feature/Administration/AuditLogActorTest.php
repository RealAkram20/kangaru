<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;

/**
 * The audit log renders the person who made each change.
 *
 * This test exists because that path had no coverage at all, and the gap
 * cost a production 500: `AuditLogController` eager-loaded the actor with a
 * column list that enumerated exactly the fields `UserResource` read, so
 * the moment the resource gained `status` the endpoint broke. Every test
 * passed. It was found by calling `/api/v1/audit-logs` against the running
 * application, and the dashboard's "Recent activity" feed reads the same
 * endpoint.
 *
 * The lesson is the assertion below: it is not enough to check the rows
 * come back, the **actor has to be rendered**, because that is the part
 * that touches the shared resource.
 */
it('renders the actor on an audit entry', function () {
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
        'name' => 'Ada Nakato',
    ]);

    // A real audited mutation rather than a hand-written audit_logs row:
    // the Auditable trait is what fills in the actor, and a planted row
    // would prove nothing about the endpoint that reads one.
    //
    // A booking, because that is something a Corporate Admin may actually
    // do — they read the audit log (AuditLogPolicy) but do not manage the
    // fleet, so creating a vehicle here would 403 and test nothing.
    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_name' => 'Grace Amongin',
        'passenger_phone' => '+256700000000',
        'passenger_count' => 1,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(201);

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/audit-logs')->assertOk();

    $entry = collect($response->json('data'))->firstWhere('auditable_type', 'booking');

    expect($entry)->not->toBeNull();
    // Every field of the nested actor, so a partial eager-load that omits
    // one fails here rather than in production.
    expect($entry['user']['id'])->toBe($admin->id);
    expect($entry['user']['name'])->toBe('Ada Nakato');
    expect($entry['user']['role'])->toBe('corporate_admin');
    expect($entry['user']['status'])->toBe('active');

    expect(Booking::query()->count())->toBe(1);
});
