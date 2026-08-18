<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Http;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Notifications\Channels\ExpoPushChannel;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\DeviceToken;
use Modules\Notifications\Notifications\TripOfferedNotification;

/**
 * The push that makes an offer's fifteen-second window usable (ADR-0025).
 *
 * Two things are being protected here, and only one of them is delivery.
 *
 * The other is **what a push is allowed to say**. It lands on a lock screen,
 * readable by whoever is holding the phone, and ADR-0024 §7 releases the
 * passenger's name and number only *after* the driver accepts. A driver who
 * declines should learn nothing about the person they declined — and that is
 * a rule no test would catch by accident, because leaking it breaks nothing.
 */
function driverWithDevice(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    DeviceToken::create([
        'user_id' => $user->id,
        'provider' => 'expo',
        'token' => 'ExponentPushToken[test-handset]',
        'platform' => 'android',
        'last_seen_at' => now(),
    ]);

    return [$user];
}

it('carries the pickup but never the passenger', function () {
    $offer = DispatchOffer::factory()->create(['pickup_distance_km' => 0.4]);
    $offer->load('orderRequest');

    $notification = TripOfferedNotification::for($offer);

    $payload = json_encode([
        $notification->subject(),
        $notification->body(),
        $notification->context(),
    ]);

    // The pickup is present, because a driver cannot judge a job without
    // knowing where it starts — the trade ADR-0025 §5 records making.
    expect($notification->context())->toHaveKey('offer_id');

    // The passenger is not, in any field. Asserted against the whole encoded
    // payload rather than field by field, because the failure this guards
    // against is somebody adding a helpful field later.
    $order = $offer->orderRequest;
    expect($payload)->not->toContain($order->contact_phone);
    expect($payload)->not->toContain($order->contact_name);
});

it('reaches a registered handset', function () {
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(fn ($request) => str_contains($request->url(), 'exp.host')
        && $request['0']['to'] === 'ExponentPushToken[test-handset]');
});

it('sends nothing for a driver with no registered device', function () {
    Http::fake();

    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    // Not an error and not a log line worth reading: it is the normal state
    // of every staff account, and of any driver who declined the permission.
    // ADR-0025 §3 requires the app to work for them.
    Http::assertNothingSent();
});

it('never lets a failing push break the dispatch that raised it', function () {
    // The whole reason `ExpoPushChannel` swallows. This notification is
    // raised inside the request that received a public order — a throw would
    // roll back the offer, so a passenger's ride would fail because a
    // third-party service timed out.
    //
    // The channel is exercised directly rather than through `$user->notify()`,
    // because the channel is what has to hold — a future caller outside the
    // queue reaches it with nothing else in the way.
    //
    // Mutation check: narrow `catch (\Throwable)` in ExpoPushChannel::send —
    // to `\DomainException`, say — and this fails.
    Http::fake(fn () => throw new RuntimeException('exp.host is down'));

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    // An explicit try/catch, and **not** `expect(fn () => …)->not->toThrow()`.
    //
    // That spelling was tried first and is vacuous here: it reported success
    // with the channel's catch narrowed to a type that could never match. A
    // standalone probe confirmed `send()` really did throw in that state, so
    // the expectation was passing without ever exercising the closure.
    //
    // Worth the four extra lines. A guard whose test cannot fail is not a
    // guard, and this one stands between a third-party outage and a
    // passenger's ride.
    $channel = app(ExpoPushChannel::class);
    $escaped = null;

    try {
        $channel->send($user, TripOfferedNotification::for($offer));
    } catch (Throwable $e) {
        $escaped = $e;
    }

    expect($escaped)->toBeNull();
});

it('drops a token the push service says is dead', function () {
    Http::fake([
        'exp.host/*' => Http::response([
            'data' => [['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']]],
        ]),
    ]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    // Left in place it would fail on every send forever — and make
    // `last_seen_at` monitoring useless, because the driver would appear to
    // have a device when they do not.
    expect(DeviceToken::query()->where('user_id', $user->id)->count())->toBe(0);
});

it('sends an offer by push and in-app, and never by mail', function () {
    // An offer expires in fifteen seconds. An email about one would arrive as
    // an apology. The in-app row is what a driver who refused the push
    // permission still sees.
    expect(NotificationType::TRIP_OFFERED->defaultChannels())
        ->toContain(NotificationChannel::PUSH)
        ->toContain(NotificationChannel::DATABASE)
        ->not->toContain(NotificationChannel::MAIL);
});

it('lets a driver-scoped token register and unregister its handset', function () {
    // ADR-0022's allow-list is fail-closed, so the app could not register at
    // all without these being named — and every other test here would pass.
    expect(ClientScope::routesFor(ClientScope::DRIVER))
        ->toContain('me.devices.store')
        ->toContain('me.devices.destroy');
});
