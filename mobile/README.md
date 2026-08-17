# KangaruRide Driver App

React Native + Expo. The app a driver carries: accept the trips dispatch
assigns, walk each through its lifecycle, capture odometer readings, stream
GPS, and ask the office for time off — all of it working with no signal.

Built against `docs/api/openapi.yaml`, which is authoritative (AGENTS.md:
*"Mobile apps are built against this contract; drift between code and spec
fails the build"*). Nothing here invents an endpoint. What the app needs and
the API does not yet offer is in **Raised with the backend** below.

---

## Purpose

PROJECT.md Phase 2. Seven screens, one job: make sure every completed trip
carries the six data points the anchor client accepts this platform on, and
that none of them is lost because a driver was in a dead zone in Nakasongola.

> **Scope note.** PROJECT.md currently lists "Driver mobile app" under *Phase 1
> — explicitly OUT of scope*, with drivers on a mobile-responsive web flow.
> Building this moves that item, and PROJECT.md says such a move "requires an
> owner-approved scope change, not a hallway agreement". The scope change is
> the owner's to record; this README is not it.

## Responsibilities

- Sign a driver in with `client: "driver"` and keep them signed in.
- Show today's work, in-progress trip pinned.
- Render lifecycle actions **from the server's `allowed_transitions`**.
- Capture the opening and closing odometer, each with an optional photo.
- Stream GPS while a trip is live, batched and durable.
- Raise, list and withdraw time-off requests.
- Change the admin-issued password (ADR-0016 provides no self-service reset).
- Hold everything the driver does until there is a connection, and lose none of
  it.

## Dependencies

The **forty** route names in
`App\Support\Auth\ClientScope::routesFor('driver')` and nothing else. A driver token gets `403 TOKEN_SCOPE_EXCEEDED` on anything
outside them (ADR-0022), and the list is fail-closed, so endpoints added later
start shut.

---

## Architecture

### Navigation

**Four tabs: Home, Earnings, Wallet, Profile.**

```
Home ─────── Today (trip list)
        └── Pickup               ← accepted, driver_en_route
        └── Waiting for passenger ← driver_arrived
        └── Trip in progress     ← trip_started, waiting, trip_resumed
        └── Trip map             ← full-screen, from Navigate
        └── Trips history        ← finished work, by day; All/Rides/Deliveries
        └── Trip detail          ← the record: rail from trip_events, ledger rows,
                                    odometer pair. Ride or delivery, one page.
        └── Odometer             ← modal; owns passenger_onboard
        └── Ride complete        ← pushed by the closing odometer, not a status
Earnings ─── day / week / month
Wallet ───── balance, settlement requests, recent movements
        └── Transactions         ← the wallet's View all; Today/Week/Custom
Profile ──── who the driver is: rating, vehicle, member since, documents
        └── Notifications        ← ADR-0039; what the office said, and a dot
        └── Documents            ← ADR-0033; upload, and what the office said
        └── Performance          ← ADR-0038; six dials, and the bonus week
        └── Promotions           ← ADR-0036/0037; weekly target, peak, referrals
        └── Time off
        └── Change password
        └── Updates & sync       ← the outbox, and the parked queue
```

**`Time off` had no way in until the profile screen landed.** It lost its tab
when the bar went to four and never gained a row — registered on the stack,
navigated to by nothing. Worth knowing as a shape of bug: a route that
compiles, type-checks and is unreachable.

**The parked queue moved to its own screen and did not get quieter.** ADR-0023
§6 requires a refused update to keep its payload and be *shown*; the profile row
that opens it turns red and counts when something is stuck, so it is louder
when it matters and silent when it is not — which it could not be at the bottom
of a scroll.

This replaced three tabs — Work / Time off / Account — and the reasoning on
both sides is worth keeping. The old argument was *"three tabs, because a
driver has three jobs; deeper structure would be navigation for its own sake —
this app has six screens."* It was right when it was written. The app no longer
has six screens: Earnings, Wallet, Transactions and Trips history are all real
surfaces, and the first two were reachable only by tapping a card on Home, so a
driver checking what they had made went through a screen about what they were
doing next. Three separate mockups asked for the four-tab bar and two agents
flagged it before the owner took it.

**Time off is what the fourth slot cost**, and it moved under Profile: a driver
requests leave occasionally and checks their money daily.

Two consequences to know about:

- **Each tab is its own stack**, so switching tabs does not unwind where the
  driver was. Coming back to Wallet from Home still shows the statement they
  had open.
- **A tab root's back arrow goes somewhere explicit, never `goBack()`.**
  `goBack()` on a stack root is a *silent no-op*, so an arrow wired to it would
  look live, be tapped, and do nothing. The mockups draw one on every tab root
  and a driver arriving from a Home card expects it, so Earnings, Wallet and
  Profile each pass `navigation.getParent()?.navigate('Home')` instead —
  which always does something, wherever the driver came from. `ScreenHeader`'s
  `onBack` stays optional for a header that genuinely has nowhere to go.

The tab bar also has **icons** now, where it deliberately had none. The old
objection was about icon *fonts*, where a missing glyph renders as a tofu box;
these are vectors from `ui/icons.tsx` on Lucide geometry, and a vector cannot
miss. None of them animates — DESIGN.md § Icons keeps navigation chrome static,
and these are the glyphs a driver sees more often than any others.

**One trip status belongs to exactly one screen**, and the live leg is split
across three of them rather than folded into Trip detail. The reason is that
they answer different questions at different moments: *Pickup* answers "where
is it and how far" while driving, *Waiting for passenger* answers "how long
have I been standing here", *Trip in progress* answers "how far still, and how
long so far", and *Trip detail* is the record — odometer, timeline, every
legal transition — read at a standstill. Folding them together would give the
busiest moments in the app the layout of an audit trail.

Trip in progress is also where a journey is **held and picked up again**.
Pausing is billable — `WalkInFareService::settle()` prices a `WAITING` line
from the periods those transitions open and close — so the screen says how
long the trip has been held and that the time is priced, and shows no money
figure of its own, because the rate card's free allowance is in no payload.
While a trip is held, **End trip is withdrawn**: `TripStatus::WAITING` allows
only `TRIP_RESUMED`, and offering completion there would 422 through the
outbox minutes after the driver walked away.

Two of those live screens draw a distance and neither draws a duration to go.
There is no routing engine here, and ADR-0020 §3 declined to derive minutes
from a straight line by name — so every distance says "straight line" on the
screen in words, and the driver's own maps app answers the part this platform
cannot (`src/trips/directions.ts`).

`isPickupPhase`, `isWaitingForPassenger` and `isTripInProgress` in
`src/trips/transitions.ts` implement the split and are defined next to each
other so none can quietly claim another's status. `docs/agent-worklog.md` holds the same map in one
table, because more than one agent builds these screens at once.

Odometer capture is a **modal**, not a step inside the detail screen: it is a
form completed or abandoned as a unit, and backing out must leave the trip
exactly as it was. The password form is a pushed screen rather than a modal for
the opposite reason — it is a thing a driver may reasonably start, go and check
with the office, and come back to.

**Ride complete is the one screen that is not routed from a `TripStatus`.** The
closing odometer `replace`s itself with it, and `trip_completed` still belongs
to Trip detail — this is the *moment* a job ended, read once, while Trip detail
is the *record*, read any time after. Routing the status here would
congratulate a driver for opening last Tuesday's ride. Every exit from it goes
Home rather than back, because behind it is the live-leg screen for a trip that
has just finished, where End trip would 422 out of the outbox.

**Wallet** is reached from the home screen's *Wallet balance* card, and is the
statement behind that figure: the balance answers *what*, these rows answer
*why*. Cursor-paginated over `GET /me/ledger-entries`.

The balance card is **not** the mockup's "Available Balance", and it has no
Withdraw or Add Money button. ADR-0029 §5 makes this figure *"what the office
and the driver owe each other, net"*, and negative is the **normal** state for
cash work — "available" describes money you could spend, and this is usually
money you owe. §6 rules out the platform moving money at all, so both buttons
had nowhere to go. The card keeps `walletValue` (magnitude, no sign) beside
`walletNote` (direction in words), plus a line explaining why a driver holding
cash fares owes the office.

**Both halves of a completed trip are listed.** A cash trip writes
`fare_earned` and `cash_collected`, and showing only the credit would make a
list that does not sum to the balance above it. Tips and bonuses are absent
because neither exists; a passenger is never named on a historical row
(ADR-0024 §7 releases contact details only while a trip is live).

**The two buttons raise settlement requests** (ADR-0032) — *"I've paid the
office"* and *"Request a payout"*, not Withdraw and Add Money. Neither moves
money: cash changes hands at the depot, and the office confirming the request
is what writes the ledger entry. **A pending request changes no balance**, and
every one says so on screen. The button for a kind that already has one open is
disabled rather than hidden, with the open request shown beneath it.

The sheet is deliberately **not** routed through the offline outbox, unlike
every trip transition. The outbox is right for a record of something that
already happened; this is a *message to a person*, and a queued one is worse
than a refused one — the driver walks away believing the office has been told.

**Transactions** is the wallet's *View all*: the whole statement with
**Today / This week / Custom** and a native date picker
(`@react-native-community/datetimepicker`, the Expo-supported one — free, so no
subscription). **The filtering is server-side**, and that is not an
optimisation: the ledger is paginated, so a client-side filter could only ever
search what happened to be scrolled into memory, and a driver picking a date
outside it would be told there was nothing — the most confident possible way to
be wrong about somebody's money. Both ends are whole local days and `to` is
inclusive, so picking one day returns that day rather than nothing.

**Earnings** is reached from the home screen's *Earnings today* tile, which
until now was a plain `View` that did nothing — the one place on that screen
where the obvious gesture had no effect. Day / Week / Month over
`GET /me/earnings`, a total, a breakdown by service type, time on trips, and a
hand-drawn `react-native-svg` bar chart (no charting dependency: the app
already carries SVG for its icons and rings). Three of the mockup's five money
rows are absent because the platform has no such data — tips, bonuses, and
online hours — and a fourth row the mockup had no place for, **Other work**, is
present so the breakdown adds up to the total above it. The screen shows a
warning instead of a sum if it ever does not.

**Trips history** is every job the driver has finished, from `GET /me/trips`,
grouped by day and filtered by **All / Rides / Deliveries**. Reached from the
home screen's *Earlier today* section, whose *View all* is the same control the
wallet uses.

Three things about it worth knowing:

- **The green figure is what the driver earned, not what the passenger paid.**
  The owner chose it on reconciliation: adding this list up must land on the
  total the Earnings screen shows, and that screen totals `fare_earned`. A
  backend test asserts the two agree.
- **Cancelled and no-show trips are in the list**, with `—` where the money
  goes and the status in words. The mockup had only paid work; a driver who
  drove to a pickup and was cancelled on has spent the time, and nothing else
  in the app lists that trip. Never `UGX 0`.
- **The day headings come from the server**, in the fleet's timezone, with
  `today` and `yesterday` in `meta`. Computing them on the handset would file
  an evening's trips under the wrong heading — the same UTC-boundary bug the
  earnings work found, on the one screen where the heading is the whole point.
  When the server sends neither, the heading is a date rather than a guess.

The **filter goes to the server**, for the reason the Transactions date filter
does: the list is cursor-paginated, so a client-side filter would show "three
deliveries" out of twenty-five loaded rows and imply that was all of them.

**The wallet card is the mockup's now**, and the two things that made the old
one different are preserved rather than dropped:

- **"Available Balance" is the heading only when the money is available.** The
  balance is normally what a driver *owes* (ADR-0029 §5), and "Available" over
  that figure describes money they could spend. So the heading carries the
  direction — the mockup's words in credit, **"Balance you owe"** otherwise.
  That is also what replaced the explaining paragraph the owner asked to
  remove: direction still lives in words, directly above the number, never in
  a sign or a colour alone.
- **The buttons say Withdraw and Add Money**, which ADR-0032 §1 had
  deliberately refused. The *mechanism* is unchanged — both raise a request the
  office answers — and read against the balance the words are accurate:
  `payout` moves it down, `remittance` moves it up. What they must not imply is
  immediacy, so the button's accessibility hint and the sheet both say nothing
  is transferred by this app.

**The balance is no longer compacted.** It went through `compactMoney` and
rendered 135,000 as `UGX 135K`; the mockup draws it in full, and reading it
that way showed the compact form was already against this codebase's own rule —
`compactMoney` permits itself on "a glanceable total" and refuses itself on
money somebody reconciles. A balance is the second kind. Today's earnings and
the trip count beside it stay compact.

**Wallet rows are two lines, Transactions rows are three.** The mockup's row is
title and time; the server's explanation is the third line and is where
ADR-0029 §3 freezes the commission rate that applied, so it is not deleted from
the app — the wallet is the glance, Transactions is the record.
`StatementRow`'s `compact` prop is that split.

**"Withdrawal" is a row again, named by the sign.** The earlier refusal was
half right: one word for a *kind* that runs both ways names the rarer half. A
negative settlement is a withdrawal and a positive one is cash handed over, and
neither is mislabelled.

**Tips and bonuses are real now** (ADR-0034), and three screens' docblocks
saying they did not exist have been corrected rather than left to rot.

A driver declares a tip from **Ride complete** — the moment they were handed
the cash, and the only moment that needs no trip picker, which is how a
declaration lands on the wrong job. It is a button, not a prompt: most trips
carry no tip, and a screen that asks after every one is a screen whose
question stops being read.

The sheet says two things before a figure is typed: the office confirms it, so
**the balance moves then and not now**; and **commission applies at the usual
rate**, because the owner ruled tips commissionable and a driver who learns
that from their balance instead has been ambushed by a rule. It does **not**
print the rate — that is a runtime setting, and a handset that stated it would
go on stating the old number.

Rows say **"Tip"**, never "Tip from Sarah N.". A declaration says *"Tip on trip
#412"*. ADR-0024 §7 releases a passenger's details only while a trip is live,
and a wallet statement is permanent and scrollable — the server sends no name
for the app to print. The glyphs are Lucide `hand-coins` and `award`, not the
mockup's star: a star means a **rating** in this product, and reusing it for
money would invert it platform-wide.

Bonuses arrive on their own, from a scheduled weekly award. The app never
learns the target or the amount — only the credit that was actually made.

Ride complete states three figures — the fare, the platform's fee and what is left — all
read back from the ADR-0029 ledger entry that recorded the credit, with the fee
derived server-side as `gross − earned` so it reports the rate **in force when
the trip completed**. The commission percentage is deliberately not served: it
is a runtime setting, and a handset that printed it would go on printing the
old one. Most of the time the driver arrives before the server does —
completion is queued through the outbox — so the ordinary state is a sentence
saying the trip is saved and will be sent, and a wallet balance flagged as not
yet counting this trip.

**Changing the password is the one write that does not go through the outbox.**
It re-authenticates with the current password, and `PATCH /auth/password`
revokes every token including the caller's — so a queued credential change would
sign a driver out mid-shift for a reason they no longer remember. It needs a
connection and says so, and on success it signs out locally rather than making
one more request it knows will 401.

**Help & Safety carries an SOS button now, and it dials.**

The first cut of that screen refused one, on reasoning still recorded in its
docblock: an SOS with no monitored channel behind it *"would write a log line,
show a reassuring confirmation, and leave somebody in trouble believing help was
coming."* That is a refusal of a **platform alert**, and it stands. What the
screen has is a dial: it opens the handset's dialler on the emergency number the
office publishes, says *"Tap to call emergency services"* on its face, and
prints the number it is about to call. Nothing is posted and nothing is
confirmed.

Three properties are what make the prominence honest, and each is pinned by a
test that fails when it is broken:

- **No number published, no red button.** `emergency_number` is a public setting
  and is empty by default; an unconfigured deployment gets a notice telling the
  driver to save their own local number *before* they need it. A dead SOS is
  exactly the control that was refused.
- **Nothing is hardcoded.** 999 is Uganda's, and this product is built to run
  elsewhere.
- **A screen reader hears the act, not the letters** — "Call emergency services
  on 999", never "Emergency, S O S".

The **position sentence** stays, though the mockup draws no such card. On duty
the app streams position (ADR-0024 §2) and a dispatcher can already find the
driver; off duty it streams nothing. A driver in trouble off duty who does not
know that will wait for help nobody has been asked for. It is the only place in
the app that says what the platform can currently see.

**Help Topics route to a person, not to a form.** The mockup's five rows read as
a ticket queue, and there is no issue-reporting endpoint on this platform — no
table, no route, no office-side inbox — and no messaging either. So a topic
opens **Support** with the office's real number and the two or three specifics
that particular call needs (`support/topics.ts`), and prefills a mail subject.
It prefills no mail **body**: whatever this app wrote would arrive at the office
looking like the driver's own words. The honest version of the mockup's intent —
a driver raising a request the office answers — is a backend feature with an ADR
attached, and is named as a gap rather than faked.

**The office's emphasis is rendered, not printed.** The safety guidance is an
editable setting and the shipped one bolds its most important sentence with
`**`, which reached the driver as literal asterisks. `support/prose.ts`
interprets that one marker and **nothing else** — no headings, lists or links —
because the value has no editor to teach a syntax to, and a Markdown dependency
to bold one sentence is not a trade this app should make. Text with no markers
comes back unchanged, so Terms and Privacy are untouched.

Three additions to the shared vocabulary came out of it: `IconChip` (the mockup's
glyph-in-a-well, five times on that screen alone), `MenuRow`'s `longValue` — for
a row whose value is an identifier rather than a status, which is why
"Email the office" no longer clips to **"Email th…"** beside a truncated
address — and `emphasisSegments`.

### State, and where each kind lives

| What | Where | Why |
|---|---|---|
| Bearer token | `expo-secure-store` (Keychain / Keystore) | ADR-0022's threat model is a credential at rest on a lost handset. Keystore is excluded from device backups; AsyncStorage is not. |
| Things the office said (trips, leave) | React Query, persisted to AsyncStorage | Losing it costs one refresh. Persisted so the morning's work renders at launch in a dead zone. |
| Things the driver did | **SQLite outbox** | Losing one loses a contractual data point. See ADR-0023. |
| GPS pings | SQLite, separate table and sender | At-least-once, no reconciliation needed. Different semantics, so a different queue. |
| The token, module-scope | `src/auth/currentToken.ts` | One token belongs to the process, not to a component. Read at request time so an in-flight call uses the live token. |

Every read is `networkMode: 'offlineFirst'`. React Query's default *pauses* a
query when the device reports no connection, which on a handset that flickers
in and out of coverage is a blank screen where the last known answer should be.

### The offline queue

**ADR-0023** is the full argument. The short version:

Transitions are **at-least-once on the wire, exactly-once in effect**, and the
guarantee rests on two things that only work together:

1. **`inflight_at` is committed before the request goes out.** An app killed
   mid-request restarts holding a row that says *outcome unknown* — which is
   the truth — instead of one that says *untried*.
2. **An unknown outcome is reconciled, never replayed.** `GET /trips/{id}`, then
   compare: at the target means it landed; at the `expected_from` recorded when
   the driver tapped means it did not; anything else needs a person, so the item
   is **parked** with its payload intact and shown on Profile → Updates & sync.

Plus **head-of-line blocking per trip**, which is not an optimisation: an item
behind a stalled one must not overtake it, or the stalled item's `expected_from`
would no longer describe the state the reconciler sees.

Why the machinery, when the server's state machine refuses most replays with a
409? Because of `waiting ⇄ trip_resumed`. It is the lifecycle's only cycle, so
it is the one place a replay is *accepted* rather than refused — silently
pausing the trip a second time and writing a second row into `trip_events`,
which is what waiting-time billing is computed from.

Failures are classified by `code`, never by message text. **Nothing is ever
deleted because a request failed.**

### GPS

Streams only between `trip_started` and `trip_completed`, and the narrow window
is deliberate. `RouteDistanceCalculator` sums every ping on a trip with no time
bound, and `TripStateMachine::reconcileAgainstGps` compares that total against
`odometer_end - odometer_start`, which excludes the drive to the pickup.
Streaming while en route would add kilometres to one side of that comparison and
raise a variance flag on a trip where the driver did nothing wrong — and
PROJECT.md commits to reviewing those flags within two business days, so a flag
that fires on every long pickup is a flag that gets ignored.

Started by `GpsController`, mounted once in the authenticated shell and driven
by the trip list — **not** by the trip-detail screen. A driver who force-quits
mid-trip and reopens the app on another tab must still be recording.

Coordinates travel as `{lat, lng}` in named fields the whole way. `toPingBody`
is the single place they become `latitude`/`longitude`, and it is one line under
test: Uganda at ~0.3°N, ~32.6°E means a swap passes every range check and lands
the vehicle off the coast of Ghana.

### Polling, and what it costs

There are no push notifications in Phase 1, so the trip list polls every **60
seconds, foreground only**. Roughly 60 small requests an hour; the radio wake is
the cost, not the bytes, and at that interval it coincides with traffic the
handset is generating anyway. Ten seconds would roughly quadruple it for a
signal that changes a few times a shift. Nothing polls in the background — an
app that drains battery for an assignment nobody is looking at gets force-stopped,
after which it receives nothing at all.

---

## Testing

```bash
npm test          # jest
npm run typecheck # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run lint      # eslint, flat config
```

61 tests, plus 8 on the backend seeder. They sit almost entirely on pure logic over injected ports, which is
what makes them worth trusting — the outbox processor talks to an
`OutboxTransport` interface and an `OutboxStore` interface, so "the app was
killed mid-request" is a test rather than a manual procedure.

**Every guard in this app has been mutated and confirmed to fail its test.**
AGENTS.md: *"a test that still passes with the logic deleted is a false green"*.
The mutations run and killed:

| Mutation | Test that caught it |
|---|---|
| `markInflight` moved after the send | app-killed-mid-request (7 tests) |
| Head-of-line blocking removed | holds later items behind an unresolved one |
| 409 always parks / always completes | the two `INVALID_TRIP_TRANSITION` tests |
| 5xx treated as a clean failure | treats a 5xx as an unknown outcome |
| Re-entrancy guard removed | refuses to run two drains at once |
| Backoff jitter removed | spreads retries across a window |
| Driver-actionable filter removed | drops transitions forbidden to a driver |
| GPS window widened to `driver_en_route` | does not stream before the opening odometer |
| Odometer requirement dropped | demands an opening reading to start |
| Photo abandonment removed | sends the number alone after repeated failures |
| `lat`/`lng` swapped | puts latitude in latitude |
| Password min-length / confirmation / different-from-current | the three `passwordProblem` tests |
| Trip grouping / sort direction | four ordering tests |
| `streamingTripId` falls back to first trip | streams for nothing when no trip is live |
| Driver gate dropped from `Trip.earnings` | never shows one driver what another earned |
| Ledger loaded on the trips list | does not read the ledger on the trips list |
| Fee recomputed from the live rate | reports the rate in force when the trip completed |
| `compactMoney` used for a settlement | shows the exact figure rather than the compact one |
| Wallet "not counting this trip yet" suppressed | warns that the balance excludes the trip just finished |
| Closing odometer `goBack`s | sends the driver to the completion screen |
| Earnings boundary bound without `->utc()` | counts a late-evening trip in the driver's day (7 tests) |
| Unclassifiable earnings dropped from the breakdown | always has a breakdown that adds up to the total |
| Trend stops zero-filling empty buckets | serves a continuous 24-hour series |
| `cash_collected` left in the earnings sum | totals the driver share and excludes the cash-collected side |
| Chart divides by a peak of zero | draws a flat chart rather than NaN heights |
| Earnings heading fixed to "Today's earnings" | renames the total when the tab changes |
| Ledger cursor ordered by `created_at` | pages without skipping or repeating a row of the pair |
| Ledger service-type map dropped | says whether a fare was a ride or a delivery |
| Ledger `driver_id` scope dropped | never shows one driver another driver's ledger |
| Row minus sign made a hyphen | uses a true minus sign, not a hyphen |
| Settlement announced as "to you" | never tells a driver they were paid the cash they handed over |
| Confirm's idempotency guard removed | pays exactly once however many times confirm is pressed |
| `ledgerSign()` inverted | writes one settlement entry when the office confirms a remittance |
| Ledger date filter measured in UTC | narrows to a range, measured in the driver's local day |
| `parseAmount` multiplies by 100 | never multiplies by a hundred, because UGX is zero-decimal |
| Today's range drops its inclusive end | asks the server for today, at both ends of the day |
| `rowTitle` narrowed to `service_type` | a tip keeps its own name instead of becoming "Ride earnings" |
| Tip button reworded to "Add a tip" | reports a tip rather than sounding like it creates one |
| Commission rate printed in the tip sheet | never prints a rate, which is a runtime setting |
| Tip sheet stops saying "not now" | says the balance moves on confirmation (2 tests) |
| Tip row stops naming its trip | names the trip, never the passenger |
| Tip/bonus breakdown labels deleted | names them in the plural, like every other row (2 tests) |
| "Available Balance" printed over a debt | says the balance is owed, in the heading (2 tests) |
| Balance compacted back to `UGX 135K` | shows a large balance exactly (2 tests) |
| Every settlement called a withdrawal | names a settlement by its direction |
| Sheet stops saying nothing is transferred | never lets a short label imply the money moved (3 tests) |
| Today's time back to 24-hour | says "Today" with a 12-hour time (2 tests) |
| A tip routed through `recordSettlement` | writes the pair, so the driver owes the commission (4 backend tests) |
| No commission taken on a tip | never credits the gross tip (3 backend tests) |
| Tip's cash half written positive | the net of the pair is the commission |
| Tip's trip-ownership check dropped | refuses a tip declared against another driver's trip |
| `bonus_enabled` ignored | awards nothing while the scheme is switched off (22 tests) |
| Double-award guard removed | never pays a week twice, however often the command runs |
| Bonus week bound without `->utc()` | counts a trip into the fleet's week, not UTC's |
| Bonus command awards the week in progress | names the week that has just closed |
| Bonus target ignored | does not credit a driver who fell short |
| History money divided by 100 | does not divide a zero-decimal currency (2 tests) |
| History renders `UGX 0` for a missing figure | em dash rather than a zero, screen and helper (2 tests) |
| Day heading computed from `new Date()` | uses the server's day keys, not the handset's clock |
| 12-hour clock by a bare modulus | gets midnight and noon right |
| Rows inside a day left in cursor order | re-sorts by `happened_at` within a section |
| Status never printed beside a route | cancelled rows say so in words (2 tests) |
| Every ending coloured as a caution | colours an ending by DESIGN.md §3 |
| Cancellation left to colour and an em dash | announces "Cancelled. No earnings recorded." |
| History tenant scope left on | serves a walk-in trip (12 of 16 backend tests) |
| `cash_collected` summed into a history row | reads the credit, not the cash held (3 backend tests) |
| History day computed in UTC | files a row under the fleet's local day |
| Live trips let into the history | includes the cancelled ones and excludes the live ones |
| History chip filter ignored | filters to one kind of job, in SQL |
| History cursor ordered by `completed_at` | pages without skipping or repeating a trip |

One of those mutations found a **false green in the test suite itself**:
`(await store.pending())[0]?.inflightAt` is `undefined` when the row was parked
instead of deferred, and `expect(undefined).not.toBeNull()` passes. The helper
`onlyPendingItem` now asserts the row exists first.

### Not covered, and why

- **No screen-render tests.** The screens are thin: every decision they make is
  in `transitions.ts`, `ordering.ts` or the outbox, all directly tested. Render
  tests here would mostly assert that React Navigation works.
- **`SqliteOutboxStore` is not exercised against real SQLite.** The processor's
  logic is tested against `MemoryOutboxStore` through the same interface; what
  is untested is that SQLite persists, which is SQLite's job. A device test
  against a real database is the honest next step and is not done.
- **Nothing has been run on a device or simulator.** No Expo build, no emulator,
  no live backend. `npm test`, `tsc` and `eslint` pass; that is the whole of
  what has been verified.

---

## Running a first test

### 1. A backend the phone can reach

```bash
cd backend
php artisan serve --host=0.0.0.0 --port=8000
```

`--host=0.0.0.0` matters for a physical handset — the default binds to
localhost and the phone gets nothing. Find the machine's LAN address
(`ipconfig`) and check `http://<address>:8000/api/v1/public/settings` loads on
the phone's browser before blaming the app.

### 2. A driver who can sign in

`migrate:fresh --seed` gives you fourteen driver *profiles* and no driver
*account* — ADR-0016 made those two different things. So:

```bash
php artisan db:seed --class=DriverAppSeeder
```

It prints the credentials and where the live trip currently is. It is
re-runnable, restores the password after you have tested changing it, and
refuses to run outside `local`/`testing`/`staging`.

| | |
|---|---|
| Email | `driver@kangaruride.test` |
| Password | `driver-demo-password` |
| Starts with | one `assigned` trip, two completed ones |

### 3. The app

```bash
cd mobile
npm install
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000/api/v1 npx expo start
```

Substitute your own LAN address. Without the variable it defaults to
`http://10.0.2.2:8000/api/v1`, which is the **Android emulator's** route to the
host and is wrong on a real phone.

Use a physical device. GPS and the camera are the two things most worth testing
and the two an emulator fakes worst.

### 4. What to test, in this order

1. **Sign in.** Confirms the token and its scope.
2. **Accept the trip, then walk it to Driver Arrived.** Confirms actions are
   rendered from `allowed_transitions` — note there is no Cancel button, which
   is the point: the server lists `cancelled` as legal from `assigned` and the
   policy forbids it to a driver.
3. **Aeroplane mode. Board, start the trip, enter an odometer reading, take a
   photo. Force-quit the app. Reopen it. Turn the signal back on.** This is the
   acceptance test for the entire offline design (ADR-0023) and no unit test
   substitutes for it. The reading must arrive, exactly once.
4. **Drive 2 km with the trip live, then complete it.** Check the console: the
   trip should carry both readings, a `gps_distance_km` close to the odometer
   span, and no variance flag.
5. **Change the password** from Profile. Every device signs out, including this
   one. Re-run the seeder to get the documented password back.

### Verified against the running backend

These are the app's load-bearing assumptions, checked against a live API rather
than reasoned about:

| Assumption | Result |
|---|---|
| `client: "driver"` mints a working token | 200, `mfa_enabled: false` — one-step login |
| The token cannot reach the console | `GET /users` → **403 `TOKEN_SCOPE_EXCEEDED`** |
| `/trips` is server-scoped to this driver | 3 trips, all theirs |
| `allowed_transitions` includes actions a driver may not take | `assigned` → `["accepted","rejected","cancelled"]`, and posting `cancelled` → **403 `FORBIDDEN`** |
| A replayed transition is refused | second `accepted` → **409 `INVALID_TRIP_TRANSITION`** — ADR-0023's premise |
| A wrong current password is distinguishable | **422 `INVALID_CREDENTIALS`**, not `VALIDATION_FAILED` |
| Changing the password kills the caller's token | next request → **401** |

Accounts are issued by an administrator (ADR-0016). There is no sign-up and no
password reset, by design, and the sign-in screen says so rather than offering a
dead link.

---

## Raised with the backend

Per the brief: flag, do not invent. None of these is worked around in a way that
hides it.

1. **`allowed_transitions` is state-legality, not permission — so it cannot be
   rendered verbatim.** `TripResource` says as much in its own comment. From
   `assigned` the server legally allows `cancelled`, and `TripPolicy` refuses it
   to a driver, so a button rendered straight from the field can only produce a
   403. The app filters against `DRIVER_ACTIONABLE_STATUSES`, a flat list
   mirroring `TripPolicy::DRIVER_JOURNEY_STATES` — no edges, so nothing to
   drift, and the server stays the authority. **Ask:** an
   `allowed_transitions_for_me` field on `TripResource`, computed from the
   policy. Additive, so permitted within v1.

2. **A trip carries no scheduled time, so "soonest first" is unbuildable.**
   `TripResource` exposes `booking_id` but no `scheduled_for`; `/trips` supports
   no `?include=booking` and no sort parameter, and orders `created_at desc`.
   The app groups (in progress → upcoming → finished) and sorts `created_at`
   *ascending* within each group as a proxy, documented as one in
   `src/trips/ordering.ts`. It breaks the moment a dispatcher assigns tomorrow
   morning's booking before this afternoon's. **Ask:** `scheduled_for` on
   `TripResource`.

3. **No idempotency key on `POST /trips/{trip}/transitions`.**
   `TripTransitionRequest` is `additionalProperties: false`, so there is no
   field for one and no `Idempotency-Key` header is read. Worked around by
   reconstructing intent from trip state (ADR-0023 §3–4), which costs a `GET`
   per ambiguous item and cannot be as good as the server saying so. **Ask:** an
   `Idempotency-Key` header, as `Modules/Billing` already does for invoices.

4. **No driver-facing notification type.** `Notification.type` is
   `booking.approved | booking.rejected | report.export.ready`. There is nothing
   for "you have been assigned a trip", so `notifications.index` — one of the
   nineteen scoped routes — returns an empty inbox for every driver, and polling
   `/trips` is the only assignment signal. The app does not render an inbox at
   all rather than shipping a screen that is always empty. **Ask:** a
   `trip.assigned` notification type.

5. **No push notifications** (brief gap 2, PROJECT.md Phase 1). Polling is the
   consequence; the interval and its battery cost are in `src/config.ts`.

6. **No offline sync endpoint** (brief gap 3). Owned entirely by ADR-0023, as
   the brief says it must be.

Not a gap, recorded so nobody re-derives it: **`POST /me/availability-requests`
is throttled to 10/minute.** The outbox honours `Retry-After` on a 429 rather
than backing off on its own schedule.

---

## Public APIs

| Module | Exports |
|---|---|
| `src/api` | `ApiClient`, the endpoint functions, `ApiError` / `NetworkError`, wire types |
| `src/auth` | `AuthProvider`, `useAuth`, `currentToken`, `sessionEvents`, `passwordRules` |
| `src/offline` | `OutboxProcessor`, `OutboxStore` + two implementations, `SyncProvider`, `useSync` |
| `src/trips` | `driverActions`, `shouldStreamGps`, `streamingTripId`, `orderTripsForToday`, query hooks |
| `src/location` | `GpsStreamer`, `GpsPingBuffer`, `GpsController`, `toPingBody` |
| `src/ui` | `Button`, `Card`, `Field`, `StatusPill`, `Notice`, `Screen`, `Empty`, `SyncBanner` |

## Related decisions

- **ADR-0023** — this app's offline outbox
- ADR-0022 — token scope per client app
- ADR-0017 — resource availability, §6 for the driver's own requests
- ADR-0016 — driver sign-in accounts
- ADR-0008 — 24-hour tokens, and why 401 pauses rather than fails
- ADR-0003 — GPS ingestion, and why `POST /locations` answers 202
