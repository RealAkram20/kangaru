# ADR-0046: Staying reachable while a driver is on duty

**Status:** Accepted (20 August 2026)

**Depends on:** ADR-0023 (the offline outbox, whose dead-zone thesis decides
what any of this is allowed to depend on), ADR-0024 (the offer and its clock),
ADR-0025 (push notifications — this supersedes parts of it).

**Supersedes within ADR-0025:** its "What this deliberately does not do"
clause, *"No rich or actionable notifications"*, and the framing of §3 that
treated push as a latency improvement over a foreground poll. Both were right
for an app a driver was looking at. Neither survives contact with a phone in a
pocket.

## Context

The owner asked for three things, in one sentence each:

1. The app keeps working in the background for as long as **"You are online"**
   is on.
2. An order request announces itself **the way a WhatsApp call does**, when the
   phone is locked or the app is closed.
3. A **ringtone plays while the countdown is running**.

Tracing those through the app found that none of the machinery they assume was
actually working, and that one of the gaps was a live bug rather than a missing
feature.

**Push had never worked, on any handset.** `getExpoPushTokenAsync` requires an
EAS project id; `app.json` had no `extra.eas.projectId`, so the call threw, and
`PushRegistrar`'s deliberately-silent catch swallowed it. Every other part of
the push path — the channel, the device token table, the notification, the
allow-listed routes — was correct and untestable behind that one missing key.

**Nothing in the app handled a notification.** No `setNotificationHandler`, no
response listener, no cold-start check. A push arriving with the app open was
suppressed by Android; a tap opened the app on whatever screen it was showing
and left the offer to the five-second poll. The push shortened nothing.

**A driver in their pocket silently left the dispatch pool.**
`PresenceController` is a `setInterval` in a React component. Android throttles
those on backgrounding and stops them when the process is trimmed, and
`dispatch.presence_ttl_seconds` is 180. So three minutes after the screen went
dark, a driver stopped being dispatchable while their app still read *"You are
online"*. `DutyBar`'s own docblock names that as the worst failure this feature
can have — *"a driver sitting for an hour under a green light, certain the
platform is ignoring them"* — and it was live.

**A late push could ring for a dead job.** `ExpoPushChannel` sent no `ttl`, and
Expo's default keeps a message deliverable long after a fifteen-second offer
has gone.

## Decision

### 1. The Android foreground service is the keystone, and it is location

While a driver is online, `Location.startLocationUpdatesAsync` runs with a
`foregroundService` — the ongoing *"You are online"* notification. That service
keeps the process alive, and everything else here depends on it: the heartbeat
keeps its cadence, a background push handler actually runs, and a ringtone can
be started from JavaScript.

There is no general "keep my app awake" permission, and there should not be.
Android grants process life only for a declared, user-visible purpose, and
**location is the honest one here** — reporting a dispatch radius is precisely
what the app is doing. That matters practically as well: Google Play's approved
foreground-location use cases name *"ride tracking for ride share"*, and would
not have covered a service invented as a pretext for a wake lock.

The alternative — a data-only push that builds the call screen from a
background handler — was rejected as the *primary* mechanism because it does
not work: Android does not deliver data-only messages to a terminated process,
and `expo-notifications`' background task does not fire there
(expo/expo#38223, #13767). A design whose central path is broken in exactly the
state it exists for is not a design.

**iOS has no equivalent, and this ADR does not pretend otherwise.**
`UIBackgroundModes: location` keeps positions arriving, but the system may
still suspend the app, and push is what wakes it. The asymmetry is recorded
rather than papered over.

**The heartbeat is now shared, not duplicated.** `reportPresence` is a pure
function over injected ports (`mobile/src/duty/presence.ts`), called by both
the foreground controller and the OS-driven task. Two copies would have drifted,
and the half that drifts first is the background one — whose bugs are invisible
by construction, because a driver cannot see a ping that was not sent.

### 2. A push says how it wants to be delivered, and it dies with its subject

`KangaruNotification::pushOptions()` — empty for almost everything — is merged
over `ExpoPushChannel`'s defaults. The channel stays a transport that knows
nothing about dispatch, which is what keeps "go direct to FCM and APNs" a
second implementation rather than a rewrite (ADR-0025 §2).

`to`, `title`, `body` and `data` remain the channel's to decide. A notification
able to set `to` could deliver one driver's job offer, pickup address and all,
to a handset of its choosing.

`TripOfferedNotification` uses it for four things:

- **`ttl`, equal to the offer's own remaining seconds.** The bug fix. A push
  held while a handset was in a dead zone must never arrive afterwards and ring
  for a job somebody else has been driving for ten minutes — that is worse than
  never ringing, because the driver reaches for the phone, reads a pickup, taps,
  and is told they were too late for something they were never offered in time.
- **`channelId: offers.v1`.** Android puts the sound, importance and vibration
  on the channel, not the message, so a push without this rings with whatever
  the fallback was — silence, on many handsets.
- **`collapseId`.** One live offer per handset, replacing rather than stacking.
- **`interruptionLevel: time-sensitive`** for iOS Focus modes.

**A notification channel is immutable once created**, past its name and
description. So the id is versioned: changing the ringtone means `offers.v2`,
created alongside and with the old one deleted. `setNotificationChannelAsync`
does not fail when called again with a different sound — it succeeds and
changes nothing, which is the worst available failure mode because it works on
a developer's fresh install and not on any handset in the field.

### 3. The ringtone is bounded by a deadline, not by a caller remembering

`mobile/src/duty/ringtone.ts` is a state machine over ports; `offerRingtone.ts`
holds the `expo-audio` and `Vibration` calls. The split exists because **the
way this feature fails is by not stopping**, and that failure is worse than
never ringing: the driver has accepted, the passenger is in the car, and the
phone will not stop.

Three routes reach it, and only the first is obvious — a missed `stop`; a
`stop` called on a *different* player after a remount (`OfferPresenter`
deliberately remounts on `key={offer.id}`); and the player outliving the
JavaScript that owned it, which Expo SDK 57 currently does (expo/expo#47569).

So: **one module-scope player, and a hard deadline armed at `start` from the
offer's own window.** Even if every caller forgets, and even if the release
path is the one Expo is getting wrong, the handset falls silent two seconds
after the offer could no longer be live. Four tests fail if that deadline is
removed.

`duckOthers`, never `doNotMix`: a driver being offered a job is often
mid-turn-instruction, and cutting Google Maps off is a road-safety problem
rather than a UX one.

**A driver can silence the ring without silencing the job.** Without that
setting their only control is Android's own, which switches the whole channel
off — banner, heads-up and all — silently, permanently, and invisibly to the
office, which then sees a driver who appears to have stopped accepting work.

### 4. Withdrawal is an accelerator; the clock on the device is the mechanism

`TRIP_OFFER_WITHDRAWN` is the only silent notification in the platform and the
only one whose purpose is to *undo* an interruption. It shows nothing, writes
no inbox row — "a job you never answered was withdrawn" is an entry for a
non-event, once per cancelled ride — and carries `withdrawn: true` beside the
offer id.

It is sent when another driver wins a wave and when a passenger cancels. The
second is the case it was written for: cancellation is the one path that kills
an offer while a phone is actively ringing.

**It is allowed to fail, and nothing depends on it.** The guarantee is §3's
deadline. This is the same shape ADR-0024 §5 gives the expiry command it sits
beside: *an expired offer is expired whether or not anything ran*, and the
scheduled command exists so somebody notices sooner.

The app reads `withdrawn` as an explicit `true` and treats every other value as
an ordinary offer, because the failure in that direction is silencing a job the
push was supposed to announce.

### 5. The offer window is 45 seconds, and the wave count comes down to three

Fifteen seconds was chosen against a driver already looking at the app, polled
every five seconds. It is the wrong number for a locked phone, where the ring
has to survive *wake, notice, reach, look, read a pickup, decide*. A driver who
misses offers they could never realistically have answered concludes the app
does not work, which costs the fleet far more than a slower hand-off.

Forty-five is roughly how long a WhatsApp call rings. That is not a
coincidence; it is the same problem, tuned by people with more data.

**The cost is the passenger's and it is paid in the product of two numbers.**
`offer_ttl_seconds × offer_max_rounds` is how long somebody watches a spinner
before a human takes over. Five rounds of forty-five is 3m45s, which is longer
than most people will wait before phoning the office — at which point the
matcher has produced a worse outcome than not running. So rounds go to three:
2m15s, close to the old pair's 1m15s, and the rounds given up are the least
valuable, where the matcher is offering to its fourth choice and a dispatcher
who knows the ground would do better.

### 6. The full-screen call UI is staged, and stage one carries no policy risk

What ships now is a MAX-importance channel with the ringtone, which wakes the
screen and shows a heads-up banner over the lock screen, plus tap routing that
handles all three arrivals — including a cold start from a killed process,
which `getLastNotificationResponseAsync` is the only way to see.

The true `CallStyle` full-screen intent is a second step, because **Google
Play's April 2026 policy grants `USE_FULL_SCREEN_INTENT` automatically only to
alarm-clock and phone/video-calling apps.** A dispatch app must request it from
the driver and degrade gracefully if refused — so the degraded path has to
exist and be good regardless, and building it first means a review hold can
never block the rest.

When that step is taken it will use **`react-native-notify-kit`**, the
Invertase-endorsed maintained fork. **Notifee itself must not be added** — it
was archived in April 2026.

## Consequences

A shift now survives the screen going dark, which is what the duty toggle
always claimed. The offer window is a real window rather than a poll interval.
A driver can hear a job from a pocket.

**The app can no longer be developed in Expo Go.** Push, foreground services
and notification channels all need a development build, so EAS builds and an
Expo project id become a prerequisite rather than a nicety — along with an FCM
v1 service-account key for Android and an APNs key for iOS.

**Two foreground service types now need a Play Console declaration**, not one:
`location`, for the shift, and `mediaPlayback`, which `expo-audio`'s config
plugin adds because the ringtone must be able to sound while the app is
backgrounded. Both are genuine; neither can be dropped without losing something
the owner asked for.

Worth noting while that declaration is being written: the manifest also carries
`RECORD_AUDIO`, and **it has nothing to do with this ADR** — `expo-image-picker`
adds it by default for video capture the app never does. It surfaces as
"Microphone" on the store listing. `microphonePermission: false` on that plugin
removes it, and somebody who owns the odometer capture screen should.

**Battery is now something the app spends deliberately.** A foreground service
and a minute-cadence location fix run for the whole of a shift. Bounded by the
duty toggle, which is why ADR-0024 §2 made going on duty an explicit act rather
than inferring it from the app being open — that decision is load-bearing here
in a way it was not when it was made.

**OEM battery managers will still kill the service** on the Tecno, Infinix and
Xiaomi handsets this fleet actually runs. That is not solvable in code; it needs
a one-time prompt asking the driver to exempt the app, and it remains a source
of per-driver failures that look like the platform ignoring somebody.

**Delivery remains something that can be silently wrong per-driver** — a denied
permission, a stale token, an aeroplane mode, an OEM. ADR-0025 §3 is what keeps
that from being a correctness problem, and it is unchanged: everything a push
says is independently readable from `GET /me/offers`, which the app still polls.

## What this deliberately does not do

**No accepting a job from the notification shade.** ADR-0025 ruled it out
because it needs a background task holding a token it fetched itself, which is
a different threat model than ADR-0022 reasoned about. That reasoning is
untouched — the foreground service makes the *handler* reliable, not the
credential question safe. The offer screen is one tap away.

**No CallKit on iOS, yet.** It is the only way to get a real lock-screen call
UI there, and it needs PushKit VoIP push — which Apple grants to calling apps,
tests during review, and which terminates apps that take a VoIP push without
reporting a call. It is planned as a separate submission so that an iOS
rejection cannot hold an Android release.

**No SMS fallback.** Unchanged from ADR-0025: no provider is configured, and it
stays absent until there is something behind it.

## Alternatives considered

**Shortening the poll instead.** Rejected again, on the arithmetic ADR-0025
used: a poll fast enough to serve the window is one that runs all day on a
handset the driver also needs for navigation. It is now worse than that — a
backgrounded app is not permitted to poll at all.

**A data-only push building the notification.** The obvious design, and the one
most articles describe. Rejected as the primary path because Android does not
deliver data-only messages to a killed process. It becomes viable *because* of
§1, not instead of it.

**Websockets.** Rejected by ADR-0025 for the reason that still holds: a
persistent connection dies with the process, and the process dies when the
phone is in a pocket.
