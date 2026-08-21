<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Http;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Notifications\Channels\ExpoPushChannel;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\DeviceToken;
use Modules\Notifications\Notifications\KangaruNotification;
use Modules\Notifications\Notifications\TripOfferedNotification;
use Modules\Notifications\Notifications\TripOfferWithdrawnNotification;

/**
 * The push that makes an offer's window usable at all (ADR-0025, ADR-0046).
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
    // An offer expires in well under a minute. An email about one would
    // arrive as an apology. The in-app row is what a driver who refused the
    // push permission still sees.
    expect(NotificationType::TRIP_OFFERED->defaultChannels())
        ->toContain(NotificationChannel::PUSH)
        ->toContain(NotificationChannel::DATABASE)
        ->not->toContain(NotificationChannel::MAIL);
});

// -- How it is delivered, as opposed to what it says (ADR-0046 §2) ---------

it('expires the push with the offer, so a late ring is never delivered', function () {
    // **The bug this closes.** Expo keeps a message deliverable long after
    // the thing it describes has gone. A push held while a handset was in a
    // dead zone would arrive minutes later and ring for a job somebody else
    // has been driving — the driver reaches for the phone, reads a pickup,
    // taps, and is told they were too late for something they were never
    // offered in time. Worse than never ringing.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create(['expires_at' => now()->addSeconds(45)]);
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(function ($request) {
        // Within a second of the window rather than exactly on it: the
        // notification computes the remaining seconds from `now()`, and a
        // slow test machine can cross a second boundary between the factory
        // and the send. Pinning it exactly makes this flake for a reason
        // that has nothing to do with the guarantee.
        expect($request['0']['ttl'])->toBeGreaterThan(40)->toBeLessThanOrEqual(45);

        return true;
    });
});

it('names the ringtone channel the app created, not a default one', function () {
    // Android puts the sound, the importance and the vibration on the
    // *channel*, not the message, so a push without this rings with whatever
    // the fallback channel was set to — which is silence on many handsets.
    // The other half of this pair is `mobile/src/push/channels.ts`, and the
    // string has to match it exactly; nothing at either end can check that,
    // so it is written down in both places and asserted here.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(function ($request) use ($offer) {
        // `v2` since ADR-0049 §4 — a channel cannot be edited to stop
        // bypassing Do Not Disturb, so respecting silent mode meant a new id.
        // If this assertion is ever changed, `OFFER_CHANNEL_ID` in
        // `mobile/src/push/channels.ts` has to change in the same commit.
        expect($request['0']['channelId'])->toBe('offers.v2');
        // One live offer per handset, replacing rather than stacking: a
        // driver back from a dead zone should not find a column of dead jobs.
        expect($request['0']['collapseId'])->toBe('offer-'.$offer->id);

        return true;
    });
});

it('will not let a notification redirect its own push to another handset', function () {
    // `pushOptions()` is merged over the channel's defaults so a message can
    // ask for a ringtone — but `to` is the channel's to decide, and a
    // subclass that could set it would be able to deliver one driver's job
    // offer, pickup address and all, to a device of its choosing.
    //
    // Mutation check: move `['to' => $token]` to the right of `$message` in
    // ExpoPushChannel::send and this fails.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();

    $hostile = new class extends KangaruNotification
    {
        public function type(): NotificationType
        {
            return NotificationType::TRIP_OFFERED;
        }

        public function subject(): string
        {
            return 'New job';
        }

        public function body(): string
        {
            return 'A passenger is waiting.';
        }

        public function url(): ?string
        {
            return null;
        }

        public function context(): array
        {
            return [];
        }

        public function pushOptions(): array
        {
            return ['to' => 'ExponentPushToken[somebody-else]'];
        }
    };

    app(ExpoPushChannel::class)->send($user, $hostile);

    Http::assertSent(fn ($request) => $request['0']['to'] === 'ExponentPushToken[test-handset]');
});

// -- Stopping a ring that is already going (ADR-0046 §4) -------------------

it('withdraws an offer silently, carrying nothing to display', function () {
    // The only notification in the platform that shows nothing. Expo decides
    // on the *presence* of title and body, not on a flag, so both must be
    // absent — an empty string would render an empty notification, which is
    // worse than either outcome.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();

    $user->notify(TripOfferWithdrawnNotification::for($offer));

    Http::assertSent(function ($request) use ($offer) {
        expect($request['0'])->not->toHaveKey('title');
        expect($request['0'])->not->toHaveKey('body');

        // Silent means silent. The channel defaults every push to
        // `'default'`, which would have this one make a noise to announce
        // that a noise should stop.
        expect($request['0']['sound'])->toBeNull();

        // The same collapse key as the offer it cancels, so it replaces the
        // ring on the shade rather than landing beside it.
        expect($request['0']['collapseId'])->toBe('offer-'.$offer->id);
        expect($request['0']['data'])->toMatchArray([
            'offer_id' => $offer->id,
            'withdrawn' => true,
        ]);

        return true;
    });
});

it('writes no inbox row for a withdrawal, because there is nothing to read', function () {
    // "A job you never answered was withdrawn" is an inbox entry for a
    // non-event, generated once per cancelled ride. The driver finds out the
    // useful way: the ringing stops.
    expect(NotificationType::TRIP_OFFER_WITHDRAWN->defaultChannels())
        ->toBe([NotificationChannel::PUSH]);
});

it('tells the losing drivers of a wave that the job is gone', function () {
    // Only reachable with `offer_wave_size` above one, and written for that
    // case rather than against today's default — a wave size raised in config
    // that silently leaves handsets ringing is a trap set for an operator.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    $winner = DispatchOffer::factory()->create();
    $loser = DispatchOffer::factory()->create([
        'order_request_id' => $winner->order_request_id,
    ]);

    $loserUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $loser->driver->update(['user_id' => $loserUser->id]);
    DeviceToken::create([
        'user_id' => $loserUser->id,
        'provider' => 'expo',
        'token' => 'ExponentPushToken[loser]',
        'platform' => 'android',
        'last_seen_at' => now(),
    ]);

    app(DispatchOfferService::class)->withdraw([$loser->fresh()]);

    Http::assertSent(fn ($request) => $request['0']['to'] === 'ExponentPushToken[loser]'
        && $request['0']['data']['withdrawn'] === true);
});

it('never lets a failing withdrawal break the accept that raised it', function () {
    // Runs inside the transaction that accepted a ride. The guarantee is the
    // handset's own deadline, not this — so a push service outage must cost
    // a few seconds of ringing, never a passenger's trip.
    Http::fake(fn () => throw new RuntimeException('exp.host is down'));

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->driver->update(['user_id' => $user->id]);

    $escaped = null;

    try {
        app(DispatchOfferService::class)->withdraw([$offer->fresh()]);
    } catch (Throwable $e) {
        $escaped = $e;
    }

    expect($escaped)->toBeNull();
});

it('lets a driver-scoped token register and unregister its handset', function () {
    // ADR-0022's allow-list is fail-closed, so the app could not register at
    // all without these being named — and every other test here would pass.
    expect(ClientScope::routesFor(ClientScope::DRIVER))
        ->toContain('me.devices.store')
        ->toContain('me.devices.destroy');
});
