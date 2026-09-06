# The job offer outside the app: why it never arrives, and the plan

> **Unchanged by `docs/platform-plan.md`.** Driver-app work; no `K` package touches these files.

**Status:** diagnosis complete, plan proposed, no code written.
**Date:** 2026-08-22
**Reported by the owner:** *"the popup order notification is only showing in the
app... these people will lose orders."*

---

## 1. Two surfaces, one boundary, and only one of them is broken

The platform has always had two ways to put a job in front of a driver, and they
are not competing implementations — they own different territory.

| | Inside the app | Outside the app |
|---|---|---|
| **Surface** | the order request page — `OfferPresenter` -> `OfferBanner` / `OfferScreen` | the push notification: ring on `offers.v2`, then the full-screen call over the lock screen |
| **Fed by** | `GET /me/offers`, polled every 5s while on duty | `TripOfferedNotification` -> `ExpoPushChannel` -> Expo -> FCM |
| **State today** | **works** — it is what the owner is seeing in the screenshot | **has never once run** |

**The order request page is not the bug and must not be changed.** It is the
right surface for a driver who is already in the app, and it is doing its job.

The bug is that it is currently the *only* surface, so a job reaches a driver
only while they are staring at the phone. Everything below is about the right-hand
column.

## 2. The proof, measured rather than reasoned

### 2.1 No push has ever been sent to any handset

```
SELECT COUNT(*) FROM device_tokens;                           -> 0
SELECT COUNT(*) FROM notifications WHERE type='trip.offered'; -> 38
```

Thirty-eight offers dispatched. Zero devices registered to push to.
`ExpoPushChannel::send()` returns at its `if ($tokens === []) return;` guard
every single time.

**The offer push is not late, not misrouted, and not silenced by a channel
mismatch. It is never sent.**

### 2.2 Why there is no token

`PushRegistrar` -> `loadNotifications()` -> `canReceivePush()`:

```ts
return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  && Device.isDevice;
```

In Expo Go `executionEnvironment` **is** `StoreClient`. So this returns false,
`loadNotifications()` returns null, and `PushRegistrar` returns before
`getExpoPushTokenAsync` and before `registerDevice`. No token, no row, no push.

Evidence that Expo Go is the runtime:

- the connected AVD has exactly one relevant package, `host.exp.exponent`;
  `ug.co.kangaruride.driver` is not installed;
- `mobile/android/` does not exist — no prebuild has been run locally;
- the worklog says it, unresolved: *"the duty/offer/push path still needs an EAS
  dev build"*, *"No handset has run this."*

### 2.3 The process does not survive being backgrounded

`OnlineService.goOnline()` starts `Location.startLocationUpdatesAsync` with a
`foregroundService` block. That ongoing "You are online" notification is the
keystone: it is what keeps the JavaScript alive so a push handler can fire with
the screen dark and the app closed.

In Expo Go it does not exist. From the owner's own pasted stack trace, already in
the worklog:

```
_validate (expo-location/build/Location.js:391)
"Background location is limited in Expo Go: on Android, it is not available at all"
```

**It is a `console.warn`, not a throw.** So `startPresence`'s `catch` never runs,
`goOnline` returns `true`, and `useDutyToggle`'s carefully written refusal —
*"You are on duty, but your phone refused to start the online service"* — never
fires. The driver goes on duty deaf and is told nothing. The code's own comment
calls this "the worst state this feature has".

### 2.4 The full-screen call UI cannot load either

`react-native-notify-kit` is a native module. `loadNotifyKit()` gates on
`canShowCallScreen()` -> `canReceivePush()` -> false -> null ->
`showCallNotification` returns having done nothing.

### 2.5 So the order request page is left holding the whole job, and it clocks off
with the driver

`useOffers` (`mobile/src/duty/queries.ts:85`):

```ts
refetchInterval: enabled ? OFFER_POLL_INTERVAL_MS : false,   // 5s
refetchIntervalInBackground: false,                          // <- stops on background
```

with `App.tsx` wiring `focusManager` to `AppState`. The poll runs only while the
app is foregrounded.

That is the reported symptom, exactly and completely.

---

## 3. What Sentry said, and why its silence was misleading

Sentry is live across all three apps against one EU project
(`4511950569734224`), with logs enabled on the backend at `warning` and on the
app via `Sentry.logger`. It has been reporting nothing about push. **That was
not evidence that push was healthy** — it is evidence that the push code path is
never entered.

`observability.ts` names the failure class this project keeps hitting:

> *"nothing crashed, nothing was slow, and the job still did not happen. This app
> swallows exactly that in four places on purpose"*

— a lost lock-screen Accept, an outbox database that would not open, a refused
foreground service, a refused sign-in. Each has a `Sentry.logger` line.

**Push registration is the fifth silence, and it is the only one with no log at
all.** `PushRegistrar`'s catch-all `catch {}` swallows every cause, and
`loadNotifications()` returning null is a bare `return`. Neither says a word.

Two more places where the instrumentation is pointed away from this:

- **Backend, `ExpoPushChannel`.** The empty-token guard is explicitly documented
  as not worth logging, *"because a user with no registered device is the normal
  state of every staff account"*. True for staff. **False for a driver who is on
  duty**, which is the one case where it means a passenger is about to be lost.
- **App, `beforeSendLog`.** It filters the Expo Go background-location warning by
  message. The reasoning is sound in isolation — the string cannot occur in a dev
  build or in release — but it means the single signal that *would* have said
  "this runtime cannot keep the app alive in the background" was being deliberately
  dropped for the whole period this was being tested.

None of these is a mistake in the small. Together they are why a fleet could run
for weeks with no background delivery and nothing anywhere saying so.

---

## 4. What is still broken after a dev build

Independent of the runtime. These are the next four reports if they are not
handled.

### P1 — The offer push is queued, against a 45-second countdown

`KangaruNotification implements ShouldQueue`, and `viaConnections()` puts only
`TenantDatabaseChannel` on `sync`. `NotificationChannel::PUSH->driver()` returns
`ExpoPushChannel::class`, which is **not** in that map, so the push job goes onto
the `database` queue connection.

`dispatch.offer_ttl_seconds` is 45; the worker runs `--sleep=2`. The one message
in the platform with a countdown on it is the one that waits in a queue — and if
`queue:work` is down, the in-app row still appears while the push silently never
goes.

`DispatchOfferService::ring()`'s docblock asserts the opposite of what the code
does: *"`TRIP_OFFERED` goes out on the `sync` connection like every in-app row"*.

### P2 — Nothing defends the foreground service on the handsets this fleet runs

Tecno, Infinix and Xiaomi battery managers kill foreground services. There is no
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` request anywhere, and no OEM autostart
guidance. ADR-0046 records this as unsolvable in code; it is not fully solvable,
but the exemption prompt is the difference between most handsets working and most
not.

### P3 — The offer poll gives up in the background

`refetchIntervalInBackground: false` contradicts `config.ts`'s own argument:
*"The offer poll is the one that earns background time, because it has a
passenger standing at the end of it."* Once the foreground service holds the
process alive, this is the only path that survives a lost or late push.

### P4 — The inside surface reaches out and cancels the outside one

This one is exactly the boundary in §1, violated.

`PushRouter.act()` fires two things concurrently for `open_offer`:

```ts
void queryClient.invalidateQueries({ queryKey: ['offers'] });  // -> OfferPresenter re-renders
void raiseCall(intent.offerId);                                 // -> showCallNotification
```

The invalidation refetches, `OfferPresenter` receives the offer, and its effect at
`OfferPresenter.tsx:154` runs `hideCallNotification(showingOfferId)`.

That effect's guard is *"this component is mounted"* — not *"the driver is looking
at the app"*. The order request page stays mounted while the app is backgrounded,
so on a locked phone the call notification can be raised and then cancelled a beat
later by a page nobody can see. **The inside surface must not be able to take down
the outside one while it is invisible.** Unproven — it needs a device — but it is
precisely the class of bug that can only appear on one.

### P5 — `USE_FULL_SCREEN_INTENT` is never asked for at a useful moment

On Android 14+ it is a special app access, not granted at install, and Google's
April 2026 policy does not auto-grant it to dispatch apps. Android **silently
downgrades** an ungranted full-screen intent to a heads-up banner. Today the only
way to grant it is a row buried in Profile that a driver must go looking for.

### P6 — The office cannot see whether an on-duty driver is reachable

No surface answers "can this driver actually receive a job right now?"

---

## 5. The plan

### Stage 0 — Build it and prove the outside path. Nothing else is worth doing first.

1. `eas build --profile development --platform android`; install on the test phone.
2. Verify in order, each with evidence, stopping at the first failure:

   | # | Check | Evidence |
   |---|---|---|
   | 1 | sign in | a row appears in `device_tokens` |
   | 2 | Go Online | "You are online" in the status bar |
   | 3 | offer, app **backgrounded** | heads-up banner + ringtone |
   | 4 | offer, screen **locked** | full-screen call takeover |
   | 5 | Accept from lock screen, app **swiped away** | offer accepted server-side |

3. Record which of the five pass. Everything after is sized against that.

Each step is a DB row, a logcat line or a screenshot. None depends on judgement.

### Stage 1 — Teach the silences to speak, through the Sentry that is already there

No new infrastructure — this uses `Sentry.logger` exactly as the four existing
silences already do.

- **`PushRegistrar` distinguishes and logs three outcomes** instead of one bare
  return: *this build cannot push*, *the driver refused the OS permission*, *the
  token call failed*. `error` for the third, `warn` for the second — a driver on
  duty with no push is the same severity as a refused foreground service, which
  is already `Sentry.logger.error`.
- **`ExpoPushChannel`'s empty-token guard learns to tell the two cases apart.**
  Staff with no device stays silent. A **driver who is on duty** with no device
  row is a `Log::warning('push.no_device')` — which reaches Sentry, because the
  backend is at `SENTRY_LOG_LEVEL=warning`.
- **A "Jobs can reach this phone" row in Profile** showing the real state: push
  token registered, notification permission, online service running, lock-screen
  permission where it is readable.
- **Go Online stops failing quietly.** If the handset cannot receive offers in the
  background, the driver hears it at the moment they go on duty, in a sentence
  they can act on.
- **A desk view of on-duty drivers with no `device_tokens` row or a stale
  `last_seen_at`.** This answers P6 and is the only thing that would have caught
  the present bug without anyone reporting it.
- **Re-scope the `beforeSendLog` Expo Go filter** so the runtime's own admission
  that it cannot do background location is visible while anyone is testing that
  way, rather than dropped.

### Stage 2 — Take the offer push off the queue

- Override `viaConnections()` on `TripOfferedNotification` and
  `TripOfferWithdrawnNotification` only, adding `ExpoPushChannel::class => 'sync'`.
  **Not on the base class** — document-review pushes and all mail stay queued.
- Safe by construction: `ExpoPushChannel` already swallows its transport errors
  and `ring()` already wraps the call in a try/catch, so a slow Expo service
  cannot take a passenger's ride down with it.
- Tighten `Http::timeout(5)` to 3s now that it sits on the dispatch request path.
- Fix `ring()`'s docblock, which describes behaviour the code does not have.

### Stage 3 — Keep the process alive on Tecno, Infinix and Xiaomi

- Battery-optimisation exemption at first Go Online (`expo-intent-launcher`,
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- Per-OEM autostart deep links (Transsion, Xiaomi, Oppo/Realme, Vivo, Huawei)
  behind a **"Why jobs stop reaching you"** help screen, with manual steps written
  out for handsets where the intent does not resolve.
- Server-side: a driver on duty whose presence heartbeat is older than
  `presence_ttl_seconds` has a dead handset. Surface it rather than merely
  skipping them in the matcher.

### Stage 4 — Hold the boundary between the two surfaces

- **Gate `OfferPresenter`'s `hideCallNotification` on `AppState.currentState ===
  'active'`** (P4). The order request page owns the inside; it may only clear the
  notification when it is genuinely on screen.
- Let the offer poll run in the background **while on duty**
  (`refetchIntervalInBackground: true`, gated on `onDuty`) — the belt to push's
  braces, and what `config.ts` already argues for.
- Ask for `USE_FULL_SCREEN_INTENT` at first Go Online on Android 14+, not only
  from a Profile row.

### Stage 5 — iOS, stated honestly and deferred

No equivalent of a full-screen intent exists at any privilege level. iOS drivers
get the time-sensitive banner and the ringtone. CallKit over a PushKit VoIP push
is a separate App Store submission per ADR-0046, out of scope until Android is
proven in the field.

---

## 6. What this plan deliberately does not claim

- **P4 is unproven.** Read from the code, not observed. Stage 0 decides it.
- **Stage 3 cannot be made reliable.** OEM battery managers can kill the service
  whatever the app does. The exemption raises the floor; it does not guarantee
  it. The push is the path that still works when the service is dead, which is
  why Stage 2 comes before Stage 3.
- **The order request page is untouched by every stage except the one guard in
  Stage 4**, and that guard makes it do less, not more.
- **No estimate per stage.** Stage 0 changes the sizing of everything after it.
