<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Notification;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\SupportRequestAnsweredNotification;
use Modules\Support\Enums\SupportRequestStatus;
use Modules\Support\Enums\SupportRequestTopic;
use Modules\Support\Models\SupportRequest;
use Modules\Trips\Models\Trip;

/**
 * Driver issue reporting (ADR-0044) — the platform's largest open loop, closed.
 *
 * `docs/feature-completeness.md` §3.9 recorded this as *"not built, and
 * correctly out of scope"*; the owner reversed that after reading the Help
 * Topics card and finding five rows that led to one phone number.
 *
 * The properties worth pinning are all about the loop staying closed:
 *
 * - **A report reaches the office** as the driver's own words, unedited.
 * - **A report cannot be attached to somebody else's trip**, which would put a
 *   stranger's journey in front of the office under this driver's account.
 * - **Answering tells the driver.** An answer nobody is told about is the
 *   silence this feature exists to end, and it is the half that gets skipped.
 * - **Answering is idempotent** — a double-tap must not overwrite a colleague's
 *   reply or send a second push.
 * - **A driver cannot answer their own report**, which would make the feature a
 *   driver writing the office's reply to themselves.
 * - **The driver token can actually reach it.** `ClientScope` fails closed and
 *   no ordinary test can see an omission, because every test here mints an
 *   unscoped console token.
 */
function reportingDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/** Somebody at the office who may answer reports (`drivers.manage`). */
function officeStaff(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

// -- Raising ---------------------------------------------------------------

it('records a report in the driver own words', function () {
    [$user, $driver] = reportingDriver();

    $data = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/support-requests', [
            'topic' => SupportRequestTopic::PASSENGER->value,
            'body' => 'The passenger refused to pay at Ntinda and left the vehicle.',
        ])
        ->assertStatus(201)
        ->json('data');

    expect($data['topic'])->toBe('passenger')
        ->and($data['status'])->toBe('open')
        // Verbatim. The office reads what the driver wrote, not a summary of
        // it — nothing on this path may edit somebody's account of an event.
        ->and($data['body'])->toBe('The passenger refused to pay at Ntinda and left the vehicle.')
        // Null, not an empty string: "not answered yet" is what the driver's
        // screen renders as waiting, and the two must stay distinguishable.
        ->and($data['answer'])->toBeNull();

    expect(SupportRequest::query()->where('driver_id', $driver->getKey())->count())->toBe(1);
});

it('accepts a report about one of the driver own trips', function () {
    [$user, $driver] = reportingDriver();
    $trip = Trip::factory()->create(['driver_id' => $driver->getKey()]);

    $data = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/support-requests', [
            'topic' => SupportRequestTopic::PAYMENT->value,
            'body' => 'The fare on this trip is lower than what the passenger paid me.',
            'trip_id' => $trip->getKey(),
        ])
        ->assertStatus(201)
        ->json('data');

    expect($data['trip_id'])->toBe($trip->getKey());
});

it('refuses a report attached to another driver trip, and does not confirm it exists', function () {
    [$user] = reportingDriver();
    [, $otherDriver] = reportingDriver();
    $theirTrip = Trip::factory()->create(['driver_id' => $otherDriver->getKey()]);

    // 404 rather than 403: a refusal must not confirm the existence of a row
    // the caller may not see, or the endpoint becomes a way to probe trip ids.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/support-requests', [
            'topic' => SupportRequestTopic::PASSENGER->value,
            'body' => 'Something happened on this journey that I want looked at.',
            'trip_id' => $theirTrip->getKey(),
        ])
        ->assertStatus(404);

    expect(SupportRequest::query()->count())->toBe(0);
});

it('refuses a report too short to answer', function () {
    [$user] = reportingDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/support-requests', [
            'topic' => SupportRequestTopic::REPORT->value,
            'body' => 'test',
        ])
        ->assertStatus(422);

    expect(SupportRequest::query()->count())->toBe(0);
});

it('lets a driver raise a second report about a different afternoon', function () {
    [$user] = reportingDriver();

    // Unlike settlement and closure requests, which allow one open row each.
    // Those ask about a single state; this is an account of a thing that
    // happened, and a driver may have two bad afternoons in a week.
    foreach (['The first passenger was abusive at the pickup.', 'A second passenger did the same.'] as $body) {
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/me/support-requests', [
                'topic' => SupportRequestTopic::PASSENGER->value,
                'body' => $body,
            ])
            ->assertStatus(201);
    }

    expect(SupportRequest::query()->count())->toBe(2);
});

it('shows a driver only their own reports', function () {
    [$user, $driver] = reportingDriver();
    [, $otherDriver] = reportingDriver();

    SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::VEHICLE,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'The nearside indicator has stopped working.',
    ]);
    SupportRequest::create([
        'driver_id' => $otherDriver->getKey(),
        'topic' => SupportRequestTopic::VEHICLE,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'Somebody else vehicle problem.',
    ]);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/support-requests')
        ->assertOk()
        ->json('data');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['body'])->toBe('The nearside indicator has stopped working.');
});

// -- Answering -------------------------------------------------------------

it('tells the driver when the office answers', function () {
    Notification::fake();

    [$driverUser, $driver] = reportingDriver();
    $staff = officeStaff();

    $report = SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::PAYMENT,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'My fare for Tuesday looks short by about five thousand.',
    ]);

    $data = $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/support-requests/{$report->getKey()}/answer", [
            'answer' => 'We checked Tuesday and the missing leg has been credited to your wallet.',
        ])
        ->assertOk()
        ->json('data');

    expect($data['status'])->toBe('answered')
        ->and($data['answer'])->toBe('We checked Tuesday and the missing leg has been credited to your wallet.')
        // Named to the office, because accountability for who said what is the
        // point of `Auditable` on this model.
        ->and($data['answered_by'])->toBe($staff->name);

    // The half that gets skipped, and the reason this feature exists.
    Notification::assertSentTo($driverUser, SupportRequestAnsweredNotification::class);
});

it('does not answer twice under a double tap', function () {
    Notification::fake();

    [$driverUser, $driver] = reportingDriver();
    $staff = officeStaff();

    $report = SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::LOST_ITEM,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'A passenger left a phone on the back seat this morning.',
    ]);

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/support-requests/{$report->getKey()}/answer", [
            'answer' => 'Bring it to the Nakawa desk and we will hold it.',
        ])
        ->assertOk();

    $second = $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/support-requests/{$report->getKey()}/answer", [
            'answer' => 'Actually, throw it away.',
        ])
        ->assertOk()
        ->json('data');

    // The first answer stands and the driver is told once. A second push about
    // an answer that did not change is noise, and an overwrite would let one
    // clerk silently replace another's reply.
    expect($second['answer'])->toBe('Bring it to the Nakawa desk and we will hold it.');
    Notification::assertSentToTimes($driverUser, SupportRequestAnsweredNotification::class, 1);
});

it('refuses an empty answer, because there is no closing without one', function () {
    [, $driver] = reportingDriver();
    $staff = officeStaff();

    $report = SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::REPORT,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'Something happened at the depot that somebody should know about.',
    ]);

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/support-requests/{$report->getKey()}/answer", ['answer' => ''])
        ->assertStatus(422);

    expect($report->refresh()->status)->toBe(SupportRequestStatus::OPEN);
});

it('does not let a driver answer their own report', function () {
    [$driverUser, $driver] = reportingDriver();

    $report = SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::PAYMENT,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'I believe I am owed for three trips last week.',
    ]);

    // Otherwise the feature is a driver writing the office's reply to
    // themselves, and the queue means nothing.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/support-requests/{$report->getKey()}/answer", [
            'answer' => 'The office agrees with me.',
        ])
        ->assertStatus(403);

    expect($report->refresh()->status)->toBe(SupportRequestStatus::OPEN);
});

it('does not let a driver read the office queue', function () {
    [$driverUser] = reportingDriver();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson('/api/v1/support-requests')
        ->assertStatus(403);
});

// -- The office queue ------------------------------------------------------

it('queues unanswered reports oldest first, and hides answered ones by default', function () {
    [, $driver] = reportingDriver();
    $staff = officeStaff();

    $old = SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::PASSENGER,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'This one has been waiting three days.',
        'created_at' => now()->subDays(3),
    ]);
    SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::VEHICLE,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'This one arrived a moment ago.',
    ]);
    SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::LOST_ITEM,
        'status' => SupportRequestStatus::ANSWERED,
        'body' => 'This one is finished with.',
        'answer' => 'Collected.',
        'answered_at' => now(),
    ]);

    $rows = $this->actingAs($staff, 'sanctum')
        ->getJson('/api/v1/support-requests')
        ->assertOk()
        ->json('data');

    // Two, not three: the answered one is out of the queue. And the driver who
    // has waited longest is at the top, which is the opposite of every other
    // list on this platform and deliberate.
    expect($rows)->toHaveCount(2)
        ->and($rows[0]['id'])->toBe($old->getKey())
        // The office needs to know whose afternoon this was without a second
        // request.
        ->and($rows[0]['driver_name'])->toBe($driver->name);
});

it('filters the queue by topic, because different desks answer different things', function () {
    [, $driver] = reportingDriver();
    $staff = officeStaff();

    SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::PAYMENT,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'A payment question for the finance desk.',
    ]);
    SupportRequest::create([
        'driver_id' => $driver->getKey(),
        'topic' => SupportRequestTopic::VEHICLE,
        'status' => SupportRequestStatus::OPEN,
        'body' => 'A vehicle fault for the workshop.',
    ]);

    $rows = $this->actingAs($staff, 'sanctum')
        ->getJson('/api/v1/support-requests?topic=payment')
        ->assertOk()
        ->json('data');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['topic'])->toBe('payment');
});

// -- The token that has to reach it ---------------------------------------

it('lets a driver app token reach both report routes', function () {
    // **This assertion cannot be replaced by an ordinary request test.**
    // `ClientScope` fails closed and every test above signs in without a
    // `client`, minting an unscoped console token — so all of them would pass
    // while the driver app got 403 from the one client that has a screen for
    // this. Four endpoints have already shipped that way.
    $routes = ClientScope::routesFor(ClientScope::DRIVER);

    expect($routes)->toContain('me.support-requests.index')
        ->and($routes)->toContain('me.support-requests.store')
        // And the office half is *not* reachable from a phone.
        ->and($routes)->not->toContain('support-requests.answer');
});
