<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Drivers\Enums\ClosureRequestStatus;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Notifications\Notifications\DriverClosureAnsweredNotification;

/**
 * Closing a driver's account (ADR-0043).
 *
 * **The constraint this whole feature is shaped by**: a hard delete is not
 * available to this platform at any price. `master-plan.md` §6 stakes the
 * product on every invoice being reproducible from stored data and the ledger
 * being append-only, so a driver with history behind them cannot be erased
 * without breaking the thing the anchor client is buying.
 *
 * So the tests below are mostly about what confirmation **does not** touch, and
 * about the return path — because a closed account cannot sign in, which makes
 * this the first decision on the platform whose subject loses the only surface
 * that could tell them.
 */
function closureDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create([
        'user_id' => $user->id,
        'email' => 'john@kangaruride.test',
        'status' => 'active',
    ]);

    return [$user, $driver];
}

function closureStaff(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

beforeEach(function (): void {
    Notification::fake();
});

it('records a request without closing anything', function (): void {
    [$user, $driver] = closureDriver();

    $this->actingAs($user)
        ->postJson('/api/v1/me/closure-request', ['reason' => 'Moving upcountry'])
        ->assertOk()
        ->assertJsonPath('data.closure_request.status', 'pending');

    // **Asking closes nothing.** The driver must still be able to work until a
    // human answers — they may be mid-shift with a passenger in the car.
    $driver->refresh();

    expect($driver->status)->toBe('active')
        ->and($driver->user_id)->not->toBeNull();
});

it('lets a driver ask without explaining themselves', function (): void {
    [$user] = closureDriver();

    // Requiring a justification to leave is a dark pattern, and a mandatory box
    // produces "." far more often than it produces a reason.
    $this->actingAs($user)
        ->postJson('/api/v1/me/closure-request', [])
        ->assertOk()
        ->assertJsonPath('data.closure_request.reason', null);
});

it('refuses a second open request', function (): void {
    [$user] = closureDriver();

    $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();

    $this->actingAs($user)
        ->postJson('/api/v1/me/closure-request', [])
        ->assertStatus(409)
        ->assertJsonPath('code', 'CLOSURE_REQUEST_ALREADY_OPEN');

    // A count, not an existence check. Two pending requests are one driver
    // asking twice, and a queue full of duplicates is a queue nobody reads.
    expect(DriverClosureRequest::count())->toBe(1);
});

it('lets a driver withdraw and then ask again', function (): void {
    [$user] = closureDriver();

    $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
    $this->actingAs($user)
        ->deleteJson('/api/v1/me/closure-request')
        ->assertOk()
        ->assertJsonPath('data.closure_request.status', 'withdrawn');

    // The gap ADR-0032 left in settlement requests and recorded as more
    // annoying than it looked: without withdrawal, one-open-per-driver makes
    // the decision unfixable without ringing the office.
    $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();

    expect(DriverClosureRequest::where('status', ClosureRequestStatus::PENDING)->count())->toBe(1);
});

it('answers 404 where there is nothing to withdraw', function (): void {
    [$user] = closureDriver();

    $this->actingAs($user)->deleteJson('/api/v1/me/closure-request')->assertStatus(404);
});

it('serves the latest request, so a declined answer can still be read', function (): void {
    [$user, $driver] = closureDriver();
    $staff = closureStaff();

    $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
    $request = DriverClosureRequest::first();

    $this->actingAs($staff)
        ->postJson("/api/v1/closure-requests/{$request->id}/decline", ['reason' => 'Settle your balance first'])
        ->assertOk();

    // A driver who was refused needs to read why more than they need the row to
    // disappear. Serving only open requests would hide the answer.
    $this->actingAs($user)
        ->getJson('/api/v1/me/closure-request')
        ->assertOk()
        ->assertJsonPath('data.closure_request.status', 'declined')
        ->assertJsonPath('data.closure_request.decline_reason', 'Settle your balance first');
});

describe('confirming', function (): void {
    it('deactivates the driver and detaches their sign-in', function (): void {
        [$user, $driver] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)
            ->postJson("/api/v1/closure-requests/{$request->id}/confirm")
            ->assertOk()
            ->assertJsonPath('data.closure_request.status', 'confirmed');

        $driver->refresh();

        expect($driver->status)->toBe('inactive')
            // Detached through ADR-0016's own service, never by deleting a User.
            ->and($driver->user_id)->toBeNull();

        // The account row survives; it is the *link* that is cut. Deleting the
        // user would orphan every audit row that names them as the actor.
        expect(User::find($user->id))->not->toBeNull();
    });

    it('keeps every trace the platform is audited on', function (): void {
        [$user, $driver] = closureDriver();
        $staff = closureStaff();

        DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::FARE_EARNED,
            'amount_minor' => 12_000,
            'currency' => 'UGX',
            'description' => 'A finished ride',
        ]);

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)->postJson("/api/v1/closure-requests/{$request->id}/confirm")->assertOk();

        // **The property the whole product rests on.** `master-plan.md` §6: a
        // rushed launch can destroy audit-grade correctness in one night, and
        // an over-eager cascade on closure is exactly how.
        expect(DriverLedgerEntry::where('driver_id', $driver->getKey())->count())->toBe(1);
        // The driver row itself survives too — an invoice referencing a deleted
        // driver is an invoice that no longer reproduces.
        expect(Driver::find($driver->getKey()))->not->toBeNull();
    });

    it('stamps the closure, because the retention sweep measures from it', function (): void {
        [$user] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)->postJson("/api/v1/closure-requests/{$request->id}/confirm")->assertOk();

        // ADR-0043 §3. The sweep is W1-e's and is not built; without this
        // timestamp it would have nothing to key on.
        expect($request->refresh()->closed_at)->not->toBeNull();
    });

    it('emails the driver, because they can no longer sign in to be told', function (): void {
        [$user, $driver] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)->postJson("/api/v1/closure-requests/{$request->id}/confirm")->assertOk();

        // **The first return path this platform has built for a driver-facing
        // decision.** Asserted on the driver record's address, because by this
        // point the account is detached and there is no notifiable user left.
        Notification::assertSentOnDemand(
            DriverClosureAnsweredNotification::class,
            fn ($notification, $channels, $notifiable) => $notifiable->routes['mail'] === 'john@kangaruride.test',
        );
    });

    it('pays exactly once however many times confirm is pressed', function (): void {
        [$user] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)->postJson("/api/v1/closure-requests/{$request->id}/confirm")->assertOk();
        $first = $request->refresh()->closed_at;

        $this->actingAs($staff)
            ->postJson("/api/v1/closure-requests/{$request->id}/confirm")
            ->assertStatus(409)
            ->assertJsonPath('code', 'CLOSURE_REQUEST_ALREADY_DECIDED');

        // A second confirm would move the retention clock ADR-0043 §3 measures
        // from — which is the reason this race is worth losing safely.
        expect($request->refresh()->closed_at->toIso8601String())->toBe($first->toIso8601String());
    });
});

describe('declining', function (): void {
    it('leaves the account working and emails the reason', function (): void {
        [$user, $driver] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)
            ->postJson("/api/v1/closure-requests/{$request->id}/decline", ['reason' => 'Settle your balance first'])
            ->assertOk();

        $driver->refresh();

        expect($driver->status)->toBe('active')
            ->and($driver->user_id)->not->toBeNull()
            ->and($request->refresh()->closed_at)->toBeNull();

        Notification::assertSentOnDemand(DriverClosureAnsweredNotification::class);
    });

    it('requires a reason, because a bare refusal ends the conversation', function (): void {
        [$user] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $this->actingAs($staff)
            ->postJson("/api/v1/closure-requests/{$request->id}/decline", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);
    });
});

describe('withdrawing', function (): void {
    it('tells nobody, because the driver just did it themselves', function (): void {
        [$user] = closureDriver();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $this->actingAs($user)->deleteJson('/api/v1/me/closure-request')->assertOk();

        // Mailing somebody about a thing they did on their own handset ten
        // seconds ago is noise, and AGENTS.md is prescriptive about fatigue.
        Notification::assertNothingSent();
    });
});

describe('the office queue', function (): void {
    it('refuses staff without drivers.manage', function (): void {
        [$user] = closureDriver();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $request = DriverClosureRequest::first();

        $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER, 'tenant_id' => null]);

        $this->actingAs($dispatcher)->getJson('/api/v1/closure-requests')->assertForbidden();
        $this->actingAs($dispatcher)
            ->postJson("/api/v1/closure-requests/{$request->id}/confirm")
            ->assertForbidden();
    });

    it('puts the rows needing an answer first', function (): void {
        [$userA] = closureDriver();
        [$userB] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($userA)->postJson('/api/v1/me/closure-request', [])->assertOk();
        $answered = DriverClosureRequest::first();
        $this->actingAs($staff)
            ->postJson("/api/v1/closure-requests/{$answered->id}/decline", ['reason' => 'No'])
            ->assertOk();

        // Raised *after* the one already answered, so a plain newest-first sort
        // would still put it on top and the ordering rule would look right by
        // accident. This one is older in nothing but status.
        $this->actingAs($userB)->postJson('/api/v1/me/closure-request', [])->assertOk();

        $response = $this->actingAs($staff)->getJson('/api/v1/closure-requests')->assertOk();

        expect($response->json('data.0.status'))->toBe('pending');
        expect($response->json('data.1.status'))->toBe('declined');
    });

    it('names the driver, so the queue is readable', function (): void {
        [$user] = closureDriver();
        $staff = closureStaff();

        $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertOk();

        $response = $this->actingAs($staff)->getJson('/api/v1/closure-requests')->assertOk();

        expect($response->json('data.0.driver_name'))->not->toBeNull();
    });
});

it('answers 403 for an account with no driver profile', function (): void {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user)->postJson('/api/v1/me/closure-request', [])->assertStatus(403);
    $this->actingAs($user)->getJson('/api/v1/me/closure-request')->assertStatus(403);
});
