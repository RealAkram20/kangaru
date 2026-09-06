<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
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

    // Not an error: it is the normal state of every staff account, and of any
    // driver who declined the permission. ADR-0025 §3 requires the app to work
    // for them, so nothing goes out and nothing fails.
    //
    // It *is* a log line, which it was not until this was found — see
    // 'says so when an offer reaches a driver with no handset' below.
    Http::assertNothingSent();
});

// -- Which connection the push rides, which is not cosmetic (ADR-0024 §5) --

it('takes the offer push off the queue, so a 45-second window is not spent waiting', function () {
    /*
     * **The bug this closes, and why nothing here saw it for so long.**
     *
     * `KangaruNotification::viaConnections()` puts only `TenantDatabaseChannel`
     * on `sync`. `ExpoPushChannel` was not in that map, so Laravel fell through
     * to the default connection and the offer push went to the `database`
     * queue — a 45-second countdown behind a worker on `--sleep=2`, and behind
     * nothing at all on a machine where `queue:work` was not running. The
     * in-app row was still written, so from every other angle it looked sent.
     *
     * **`phpunit.xml` sets `QUEUE_CONNECTION=sync`, which is exactly why this
     * suite could not see it.** Every notification runs inline here whatever
     * `viaConnections()` says, so `it('reaches a registered handset')` above
     * passes identically with the push queued and with it inline. A test that
     * cannot distinguish the two states is not a test of this.
     *
     * So the default is moved for the length of this test. With `database` as
     * the default connection, a queued channel writes a `jobs` row and sends
     * nothing; only a channel named `sync` in `viaConnections()` reaches
     * `exp.host` during the call.
     *
     * Mutation check: delete `viaConnections()` from `TripOfferedNotification`
     * and this fails on `assertSent` — verified, not assumed.
     */
    config(['queue.default' => 'database']);

    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(fn ($request) => $request['0']['to'] === 'ExponentPushToken[test-handset]');
});

it('keys the connection by the same name Laravel looks it up with', function () {
    /*
     * The half the test above cannot fail on, and the one that would break
     * silently. `NotificationSender` reads
     * `$notification->viaConnections()[$channel]`, where `$channel` is whatever
     * `via()` returned — which is `NotificationChannel::driver()`, a class-string.
     *
     * Key the map on `'push'`, or on `'expo'`, or on any name that reads better
     * than a fully-qualified class, and the lookup misses, `?? $connection`
     * takes the default, and the push is quietly back on the queue with the
     * override still sitting in the file looking correct.
     *
     * Asserted through `NotificationChannel::PUSH->driver()` rather than by
     * repeating the class name, so this compares the two halves rather than
     * comparing one half with a copy of itself.
     */
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    expect(TripOfferedNotification::for($offer)->viaConnections())
        ->toHaveKey(NotificationChannel::PUSH->driver(), 'sync');
});

it('leaves the withdrawal on the queue, because it is sent under a row lock', function () {
    /*
     * **The deliberate asymmetry, asserted so nobody tidies it away.**
     *
     * The obvious next edit to `TripOfferWithdrawnNotification` is to make it
     * match its sibling. It must not. `withdraw()` is called by `accept()`
     * *inside* its `DB::transaction`, after `lockForUpdate()` on the offer row
     * and after the trip has been created — so an inline push there would hold
     * those locks across a three-second call to a third party, once per losing
     * driver, sequentially. A slow minute at Expo would become lock contention
     * on `dispatch_offers` and `trips` for every ride being accepted.
     *
     * The withdrawal can afford the queue and the offer cannot: `Ringtone`
     * arms its own deadline from the offer's window, so the handset falls
     * silent whether this arrives promptly, late or never. Nothing depends on
     * its latency.
     */
    expect(TripOfferWithdrawnNotification::for(DispatchOffer::factory()->create())->viaConnections())
        ->not->toHaveKey(NotificationChannel::PUSH->driver());
});

// -- Saying so when a push reaches nobody (the failure that hid this) ------

it('says so when an offer reaches a driver with no handset', function () {
    /*
     * **The line that would have caught all of this on day one.**
     *
     * `device_tokens` was empty for the entire fleet while thirty-eight offers
     * were dispatched. `ExpoPushChannel` returned at its empty-token guard
     * every time, documented as not worth logging — correctly, for staff
     * accounts, and catastrophically for a driver who is about to be offered a
     * job they will never hear.
     *
     * `warning` and not `info`: `SENTRY_LOG_LEVEL` is `warning`, so anything
     * below it never leaves the machine, and a log nobody receives is the same
     * silence this replaces.
     */
    Log::spy();
    Http::fake();

    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Log::shouldHaveReceived('warning')
        ->withArgs(fn (string $message, array $context = []) => $message === 'push.no_device'
            && $context['user_id'] === $user->id
            && $context['type'] === NotificationType::TRIP_OFFERED->value)
        ->once();
});

it('stays quiet when an ordinary notification reaches a user with no handset', function () {
    /*
     * The other half, and the reason `pushIsCritical()` exists rather than the
     * channel simply logging every empty-token return. Every staff account in
     * the platform is in this state permanently. Logging it unconditionally
     * would produce a warning per notification per office worker — a stream
     * nobody reads, which is precisely how the line above would get lost.
     *
     * Mutation check: make `pushIsCritical()` return true on the base class and
     * this fails. **Verified by doing it** — and the first spelling of this
     * assertion did not fail, which is why it reads the way it does now.
     *
     * `Log::shouldNotHaveReceived('warning', ['push.no_device'])` was the
     * obvious form and is vacuous: Mockery reads the second argument as *the
     * complete argument list*, so it asserts that nothing called
     * `warning('push.no_device')` with **one** argument — and nothing ever
     * does, because the real call carries a context array as its second. It
     * passed with the mutation in place, which is the definition of a guard
     * that is not one. The fix is to spell the **whole** argument list —
     * message and context — with a wildcard for the half that varies.
     *
     * `shouldHaveReceived('warning')->withArgs(...)->never()` was tried in
     * between and is not the answer either: on a spy, `shouldHaveReceived`
     * verifies "at least once" as it is built, so it fails on the honest run
     * rather than on the mutated one.
     */
    Log::spy();
    Http::fake();

    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $offer = DispatchOffer::factory()->create();

    $user->notify(TripOfferWithdrawnNotification::for($offer));

    Log::shouldNotHaveReceived('warning', ['push.no_device', Mockery::any()]);
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

it('says so when the push service refuses the send itself', function () {
    /*
     * The other silence, one layer past the empty-token guard. Expo answers
     * 200 whether or not anything can be delivered; the failure arrives
     * inside the ticket. Every push this platform ever sent died with
     * `InvalidCredentials` — no FCM service key on EAS — and nothing said
     * so, because the receipt loop reacted only to `DeviceNotRegistered`.
     * Found 24 August 2026 by probing the live pipeline by hand, which is
     * exactly the visit this warning exists to replace.
     *
     * The whole argument list spelled out, per the lesson two tests up.
     */
    Log::spy();
    Http::fake([
        'exp.host/*' => Http::response([
            'data' => [[
                'status' => 'error',
                'message' => "Unable to retrieve the FCM server key for the recipient's app.",
                'details' => ['error' => 'InvalidCredentials'],
            ]],
        ]),
    ]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    // The token survives: it is not dead, the credential is. Deleting it
    // would make the fix (uploading the key) invisible until every driver
    // reinstalled.
    expect(DeviceToken::query()->where('user_id', $user->id)->count())->toBe(1);

    Log::shouldHaveReceived('warning')
        ->withArgs(fn (string $message, array $context = []) => $message === 'push.ticket_error'
            && $context['error'] === 'InvalidCredentials'
            && $context['count'] === 1)
        ->once();
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

it('names no ringtone channel, because nothing is rendered from this message', function () {
    // The ring moved entirely onto the app's own call notification
    // (`offers.call.v2` in `mobile/src/push/channels.ts`) when the offer push
    // went headless — owner's decision, 31 August 2026, recorded on
    // `TripOfferedNotification::pushIsSilent`. A `channelId` reappearing here
    // means somebody is rendering the plain banner again.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(function ($request) use ($offer) {
        expect($request['0'])->not->toHaveKey('channelId');
        // One live offer per handset, replacing rather than stacking: a
        // driver back from a dead zone should not find a column of dead jobs.
        // Also the key `TripOfferWithdrawnNotification` sends under, which is
        // what lets a withdrawal replace an undelivered wake-up in FCM's
        // queue rather than landing beside it.
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

/* ------------------------------------------------------------------ *
 * The offer push is headless (ADR-0049 §3, proved on a handset; owner's
 * decision 31 August 2026)
 *
 * The incoming-call screen is built in JavaScript, so something has to be
 * running to build it. Measured on an Android 15 handset with the app
 * backgrounded, on duty and its process alive: a push carrying a title and a
 * body produced **no line of app JavaScript at all** — Expo's Firebase service
 * rendered it natively and never woke the app. A push with no title and no
 * body, same handset, seconds later:
 *
 *     ReactNativeJS: 'offer.push_task', 'open_offer', 64, 'background'
 *
 * The offer therefore ships as ONE headless message. The visible "New job"
 * banner that used to ride beside it is gone at the owner's request — the
 * call screen, with Decline and Accept on it, is the only offer surface.
 * These tests hold the details that would silently revert that.
 * ------------------------------------------------------------------ */

it('sends one headless push, so the call screen is the only thing a driver sees', function () {
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferedNotification::for($offer));

    Http::assertSent(function ($request) use ($offer) {
        // One message for one handset. A second one reappearing here is the
        // plain banner coming back.
        expect($request->data())->toHaveCount(1);

        // **No title and no body**, because that — not a flag — is what makes
        // Android hand the message to the app instead of drawing it. A title
        // here silently reverts the whole feature: the app never wakes, no
        // call screen, and the driver sees an un-answerable banner.
        expect($request['0'])->not->toHaveKey('title');
        expect($request['0'])->not->toHaveKey('body');

        // The app reads the job out of the payload.
        expect($request['0']['to'])->toBe('ExponentPushToken[test-handset]');
        expect($request['0']['data']['offer_id'])->toBe($offer->id);

        // High priority, or Android may hold it until the next maintenance
        // window — which for a 45-second offer is the same as never.
        expect($request['0']['priority'])->toBe('high');

        // No noise from the transport: the ring belongs to the app's call
        // notification, which loops it. The channel would otherwise default
        // this to 'default'.
        expect($request['0']['sound'])->toBeNull();

        // iOS delivers a payload with nothing to show only when told so.
        expect($request['0']['_contentAvailable'])->toBeTrue();

        return true;
    });
});

it('sends one message for a notification that does not need waking', function () {
    // Almost everything on this platform. A settlement or a document review
    // has no countdown and can wait until the driver opens the app, and waking
    // a handset for one spends a driver's battery for nothing.
    Http::fake(['exp.host/*' => Http::response(['data' => []])]);

    [$user] = driverWithDevice();
    $offer = DispatchOffer::factory()->create();
    $offer->load('orderRequest');

    $user->notify(TripOfferWithdrawnNotification::for($offer));

    Http::assertSent(function ($request) {
        // A withdrawal is already silent — it *is* a wake-up, so it must not
        // be given a second one.
        expect($request->data())->toHaveCount(1);

        return true;
    });
});

it('deletes the token the dead receipt actually belongs to, not the one at that index', function () {
    /*
     * **The sharpest edge of `pushWakeOptions`: two messages per handset.**
     *
     * Expo returns receipts positionally, and `pruneDeadTokens` reads the
     * token for a `DeviceNotRegistered` out of a parallel list by index. While
     * that list was one-entry-per-handset, a notification adding a companion
     * message per handset silently shifted every index past the first — so a
     * dead receipt for one driver's handset would have deleted **a different
     * driver's** device token, and that driver would simply stop receiving
     * jobs with nothing logged anywhere.
     *
     * `TripOfferedNotification` no longer sends a pair — the offer went
     * headless and single on 31 August 2026 — but the channel's
     * `pushWakeOptions` hook remains for any notification that does, so the
     * guard is exercised through one built here rather than deleted with the
     * caller that used to prove it.
     *
     * Two handsets, four messages, and the dead receipt is at **index 2** —
     * the first handset's *companion*. That index is the whole point: it
     * exists only in the per-message list. Read against a per-handset list it
     * falls off the end, `isset` fails, and nothing is deleted at all — so a
     * test placing the error at index 0 or 1 passes under both mappings and
     * proves nothing. (Checked by mutation: it did.)
     */
    [$user] = driverWithDevice();

    DeviceToken::create([
        'user_id' => $user->id,
        'provider' => 'expo',
        'token' => 'ExponentPushToken[second-handset]',
        'platform' => 'android',
        'last_seen_at' => now(),
    ]);

    Http::fake(['exp.host/*' => Http::response(['data' => [
        ['status' => 'ok'],
        ['status' => 'ok'],
        // Index 2: the first handset's companion message.
        ['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']],
        ['status' => 'ok'],
    ]])]);

    $paired = new class extends KangaruNotification
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

        public function pushWakeOptions(): array
        {
            return ['collapseId' => 'wake-guard-test'];
        }
    };

    app(ExpoPushChannel::class)->send($user, $paired);

    $left = DeviceToken::query()->where('user_id', $user->id)->pluck('token')->all();

    // The first handset is the dead one and must be gone; the second must not
    // be touched. A mapping that reads index 2 against the two-entry handset
    // list deletes nothing and leaves both, which is what this catches.
    expect($left)->toBe(['ExponentPushToken[second-handset]']);
});
