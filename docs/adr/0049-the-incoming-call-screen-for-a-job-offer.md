# ADR-0049: The incoming-call screen for a job offer

**Status:** Accepted (21 August 2026)

**Depends on:** ADR-0024 (the offer and its clock), ADR-0025 (push
notifications), ADR-0046 (staying reachable while on duty — this is the second
stage §6 of that ADR deferred).

**Supersedes within ADR-0046:** its §3 decision that the ringtone plays
`playsInSilentMode`, and its §2 decision that `offers.v1` sets `bypassDnd`.
Both are reversed in §4 below, on the owner's instruction.

**Supersedes within ADR-0025 and ADR-0046:** the clause *"No accepting a job
from the notification shade"*, on the owner's instruction. See §6, which
records what is given up.

## Context

The owner reported the feature as not working:

> we built a push notification and background activities for the driver app.
> Provided the driver has got internet and enabled "You are online" there is
> this UI that should come with the accept or reject just for the order, the
> same way some calling apps do. But this does not come along. We said it
> should come even when the phone is locked, the same way call apps do.

**Nothing was broken.** ADR-0046 §6 deliberately shipped stage one only, and
stage one is a MAX-importance notification channel: a ringtone, a vibration,
and a **heads-up banner** — a strip at the top of the lock screen that a driver
has to notice, read and tap.

A banner is not a call screen, and the difference is a different Android
mechanism rather than a matter of degree. WhatsApp takes over a locked phone
because its notification carries a **full-screen intent**, which tells Android
to *start an activity* rather than to post a strip. `expo-notifications` has no
API for one and never has. So the popup had never been built, and no amount of
tuning the channel would have produced it.

The owner also supplied a design for the card itself — a dark teal pill with
the pickup, the distance, the fare, and a green tick and red cross — and asked
for the ring to fall silent under silent mode and Do Not Disturb, which is the
opposite of what ADR-0046 decided.

## Decision

### 1. The precondition is ADR-0046 §1, and it is what makes this buildable

A full-screen intent is set by whoever builds the notification, and here that
is JavaScript. So **the app's process must be alive when the offer arrives**.

ADR-0046 §1 is what makes that true, and it is why the location foreground
service was called the keystone: while *"You are online"* is on,
`Location.startLocationUpdatesAsync` holds an ongoing service, the process
survives, and the app's JavaScript keeps running with the screen dark and the
app swiped away. The owner's own framing — *"provided the driver has internet
and enabled You are online"* — is that precondition, arrived at from the other
end.

Off duty, none of it runs, and nothing is sent: the matcher does not offer to
drivers who are off.

**The alternative was considered and rejected as disproportionate.** Making
this work with the process genuinely dead needs a data-only FCM message and
`@react-native-firebase/messaging`'s `setBackgroundMessageHandler`, which
Android will headless-start. That means adding RNFirebase beside
`expo-notifications` — two `FirebaseMessagingService` registrations, one of
which wins — and moving the Android half of the server off Expo's push service
onto FCM v1 with a service-account key. ADR-0025 §2 keeps that available
(`device_tokens.provider` already records the token kind), and it stays
available. It is not needed for the case the owner described, and the bounded
version of the hole is small: when the foreground service dies, the presence
heartbeat dies with it, and `dispatch.presence_ttl_seconds` takes the driver
out of the dispatch pool three minutes later, so there is no offer to miss.

### 2. Two manifest edits the app owns, because no library will make them

`react-native-notify-kit` can attach a full-screen intent. It cannot make one
work, and says so: *"The plugin does not configure Firebase, does not add
`USE_EXACT_ALARM`, does not add `USE_FULL_SCREEN_INTENT`, and does not choose a
foreground service type by default."* That is the right call on their side —
`USE_FULL_SCREEN_INTENT` is a Play Store policy commitment, not a build detail.

So `mobile/plugins/withLockScreenCallUi.js` adds:

- **`USE_FULL_SCREEN_INTENT`**, without which `setFullScreenIntent` is ignored.
- **`showWhenLocked` and `turnScreenOn` on `.MainActivity`**, without which the
  intent fires, the activity starts, and Android draws the keyguard on top of
  it — the driver wakes the phone and finds their lock screen with the offer
  behind it.

**Every failure in this paragraph is silent.** Android does not refuse a
full-screen intent it has not granted; it downgrades it to a heads-up
notification, resolves normally, and logs nothing. The app therefore behaves
exactly as it did before stage two — indistinguishable from success, from the
inside. That is the first thing to check when the popup is reported missing.

**On Android 14 and above the permission is not granted at install.** Google's
April 2026 policy grants it automatically only to alarm-clock and
phone/video-calling apps; a dispatch app must ask. `fullScreenIntent.ts` opens
Android's own screen and a row in Profile offers it — worded as an action
rather than as a state, because **nothing in this stack can read whether it was
granted**. `canUseFullScreenIntent()` is the platform call and neither
`expo-notifications` nor notify-kit exposes it. A "Not allowed" label we cannot
verify would be wrong on every handset that had already said yes.

**This is why stage one was built first** (ADR-0046 §6) and why it stays good:
a refusal costs the takeover, never the offer.

### 3. The call notification is an upgrade applied on arrival, not a replacement

`offers.v2` still delivers, still rings, still shows its banner. That is the
floor, and it is the only thing that works when an OEM battery manager has
killed the service — the failure ADR-0046 records as unsolvable in code on the
Tecno, Infinix and Xiaomi handsets this fleet runs.

On top of it, when the app is there to hear the push arrive, `PushRouter` fetches
the offer and `showCallNotification` posts a second notification carrying
`fullScreenAction`, `lightUpScreen` and `category: CALL`.

**It is fetched, never read off the push.** The payload carries three fields;
the call screen needs the pickup address and the fare, which are deliberately
absent because a push reaches a lock screen (ADR-0025 §5). Asking
`GET /me/offers` also means a job another driver took while the phone was
ringing simply is not in the answer, and no call screen is raised for it.

**The library is `react-native-notify-kit`**, which ADR-0046 §6 picked in
advance: Notifee was archived by Invertase on 7 April 2026 and its own README
names this fork as the successor. The API is Notifee's, unchanged. Its import
is dynamic everywhere, for the reason `expoNotifications.ts` documents at
length — a static import of a native module took this whole app down in Expo
Go once already.

**iOS gets none of this, and not because it is unfinished.** There is no
equivalent of a full-screen intent at any privilege level; the only way to draw
over a locked iPhone is CallKit, which needs a PushKit VoIP push that Apple
grants to calling apps, tests during review, and which terminates an app that
takes a VoIP push without reporting a call. ADR-0046 keeps it as a separate
submission so an iOS rejection cannot hold an Android release. That is
unchanged.

### 4. The ring now stops for silent mode and Do Not Disturb

ADR-0046 §2 and §3 decided the opposite, on the argument that going on duty is
a statement that the driver is working and a silenced phone should still ring
for the job they signed on for.

**The owner reversed it**, and the reasoning is worth keeping: a driver
silences a phone on purpose and for reasons the app does not know — a funeral,
a clinic, a passenger asleep in the back — and an app that rings through it is
one they silence permanently, in Android's own settings, where nobody in the
office can see that they did. That is strictly worse than a missed job, because
it is invisible and it is forever.

Two halves, moved together:

- **`bypassDnd: false`** on the channel.
- **`playsInSilentMode: false`** on the audio session. Expo's own note makes
  this the whole fix rather than half of it: *"On Android, when `false`,
  playback is suppressed when the ringer mode is silent or vibrate."*

**Vibration is untouched.** A handset on vibrate has said *tell me quietly*,
not *do not tell me*.

**The channel id had to move, and that is not incidental.** An Android
notification channel is immutable once created: `setNotificationChannelAsync`
does not fail when called again with different settings, it succeeds and
changes nothing. So the change would have worked on a fresh install and on no
handset in the field. `offers.v1` is deleted and `offers.v2` created in the same
release, and `TripOfferedNotification::pushOptions()` moved in the same commit —
a server naming a channel the app has not created gets its push delivered on
the default one, silently and at ordinary importance, which presents as *"push
works, it just never rings"*.

**What is not lost:** silent means silent, not invisible. The screen still
lights and the offer still appears, because the full-screen intent rides on a
separate channel that makes no sound at all — and which therefore bypasses Do
Not Disturb without being able to wake anybody.

### 5. Two surfaces, and the mockup is two rows because a phone is not a banner

The owner's design is a single horizontal pill: **1574 × 264, a ratio of
5.96 : 1**. Its palette and type were measured out of the PNG rather than
eyeballed — `#05373F` card, `#00C0D5` eyebrow, `#01646E` badge, `#59BD47` tick,
`#DB2039` cross, `#A2E7EB` fare — and all of that is reproduced exactly.

The proportion is not, and cannot be. On a 390pt phone inside the app's 12pt
gutters that band is 366 × 61pt, and its type scales with it: the eyebrow lands
at 8pt, the pickup at 10pt, the distance at 7pt. `theme.ts` sets the floor at
15pt and says why — *"Small type is unreadable through glare"* — for a driver
glancing at a cradle in Kampala sun.

Keeping one row **and** legible type was built and measured too, and it fails on
width: at 17pt the pickup alone needs ~205pt, and a 52pt badge plus two 52pt
buttons and their gaps leave ~150pt for it. The address truncates to *"Pickup:
Kam…"*, removing the one fact the driver is deciding on in order to preserve a
silhouette.

So **the band folds at its own divider**. The vertical rule between "how far"
and "how much" becomes horizontal, and nothing else changes. Four variants were
rendered at true phone size and put in front of the owner before this was
written.

The two surfaces:

- **`OfferBanner`** in the app, over whatever the driver is doing. A job they
  may well decline should not throw away a half-filled odometer form.
- **`OfferScreen`**, the existing full takeover, when the full-screen intent
  opened the app. There is nothing to interrupt on a locked phone, and the
  driver has just been woken by a ringing handset.

`callLaunch.ts` tells them apart with `getInitialNotification()`, which is the
only way to see a launch caused by an intent — no listener exists at the moment
the runtime is created. Tapping the banner expands it; back collapses it; a
failed answer expands it, because the banner has no room to say *"another
driver was faster"* without pushing the pickup off the card.

**The mockup's "15 min trip" is rendered as a distance, and that is a
refusal.** There is no journey duration anywhere in the offer payload, and
ADR-0020 §3 declined to derive minutes from a straight-line distance by name:
real roads are longer than the crow's flight, so the figure would run short, and
it would run short in front of a passenger. `OfferScreen` states it flatly —
*"There is no ETA, and there must not be one."* A real minutes figure is
reachable now that ADR-0031 put OSRM on this project's own network, but it has
to arrive on the offer payload from the server, not from a division done on the
handset. **That is the honest way to make the mockup's line literally true and
it is left open.**

### 6. The shade buttons answer directly, and this overrides a written rule

ADR-0025 and ADR-0046 both refused to let a driver accept from the notification
shade, on one argument: it needs *"a background task holding a token it fetched
itself, which is a different threat model than ADR-0022 reasoned about"*.

**The owner was shown that reasoning and chose the direct answer**, for a
reason worth recording: a driver at the wheel who taps Accept and then waits
several seconds for a cold app launch before the job is actually theirs has, in
a forty-five second window, spent a tenth of it watching a splash screen.

Having looked at the threat model rather than inheriting the clause:

- The token is read from the same keystore through the same `readSession`, not
  from a copy this path keeps. Signing out deletes it and this then does
  nothing. ADR-0022's scoping is untouched.
- The only thing reachable with it here is answering an offer this handset was
  itself sent — two endpoints, and that is the whole surface.

**What is given up, plainly:** a handset unlocked by somebody who is not the
driver can accept or decline a job from the lock screen without a passcode.
That is the same exposure a phone call's Answer button has, it is the price of
the feature, and it is written here rather than discovered later.

The decision half is pure and tested (`offerEvent.ts`); the acting half never
throws, because an unhandled rejection in a headless task is reported to
Android as the app misbehaving, and enough of them stop it running tasks at
all. `claimAnswer` exists because Accept both fires an event and launches the
app, so notifee reports the same press twice — through the event stream and
again through `getInitialNotification()` — and two reports mean two accepts,
whose second rejection would put *"somebody else took it"* in front of the
driver who just took it.

## Consequences

A job now takes over a locked, dark, closed phone the way a call does, on
Android, while the driver is on duty.

**A new development build is required, and nothing about that is optional.**
The manifest edits land at prebuild; reloading JavaScript over Metro will not
pick them up, and the symptom of forgetting is the silent downgrade in §2.

**`react-native-notify-kit` is a new native dependency.** New Architecture only,
which Expo SDK 57 already is. Expo Go was already unsupported (ADR-0046).

**Play Console now has a third thing to declare**, beside the two foreground
service types ADR-0046 named: `USE_FULL_SCREEN_INTENT` on an app that is not an
alarm clock or a phone dialler. The degraded path is what makes a refusal
survivable, and it is why it was built first.

**None of this has been verified on a handset.** It cannot be from here: it
needs an EAS build, a real Android 14+ device, a locked screen and a live
offer. Everything that could be checked has been — typecheck, 137 mobile tests,
14 backend push tests, the palette measured against the owner's PNG — and none
of that is the same as watching a phone light up. The device pass is the
outstanding work, and §2's silent downgrade is what it is looking for.

## What this deliberately does not do

**No CallKit on iOS.** Unchanged from ADR-0046, and for its reasons.

**No `requestDismissKeyguard`.** With `showWhenLocked` the offer draws over a
locked phone and its buttons work, which is all the decision needs. Getting
*into* the app afterwards still requires unlocking, and that is right: a phone
a passer-by can drive a shift from is a worse problem than an extra swipe.

**No custom notification layout in the shade.** Android decides how a
notification looks; the owner's pill cannot be rendered there. It is rendered
where the app owns the pixels — in the app, and over the lock screen.

**No second theme.** The mockup's teal-and-cyan palette is scoped to
`OfferBanner` and is not in `theme.ts`. Putting it there would present it as a
platform palette and invite a second screen to use it, at which point the app
has two identities and no rule about which applies. An interruption surface
that does not look like the app behind it is the same argument `OfferScreen`
makes for its navy band, and the reason an incoming call does not look like the
home screen.
