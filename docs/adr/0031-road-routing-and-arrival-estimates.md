# ADR-0031: Road routing and arrival estimates

**Status:** Accepted (15 August 2026 — owner chose Google Directions directly,
after being shown the self-hosted alternative and the per-request cost)

**Depends on:** ADR-0014 (system settings — where the credential lives),
ADR-0020 §3 (the refusal this partially lifts), ADR-0026 §2 (the fare's two
distances), ADR-0023 (the offline thesis this must not break).

**Amends:** ADR-0020 §3, on arrival estimates only. Its ranking decision is
untouched.

## Context

Three surfaces in the driver app show a distance and none of them shows a
route: the pickup screen, the waiting screen and the trip in progress. Each
says **"straight line"** in words, because that is what the number is —
`GreatCircle` between two points, the same figure the matcher ranks on.

The owner, testing on a handset, asked for the thing every hailing app has:
a line that follows the roads, and a time that means something.

That was refused three times, and the refusals were right at the time.
ADR-0020 §3 declined to derive minutes from a straight line because real roads
are longer than the crow's flight, so the figure would run short in front of a
passenger. `PickupMap` declines to draw a line between two points because a
straight line is not a road, and drawing one tells a driver to turn where
there may be no turn.

**Both refusals were about *inventing*, not about *having*.** With a real
routing engine, a road distance is measured and a duration is a prediction
from traffic data rather than arithmetic on a hypotenuse. The reason to refuse
disappears; the reason to be careful does not.

## Decision

**Road routing is a backend service behind an operator-configured provider,
cached, requested on deviation rather than on a clock, and absent by default.
Everything it produces degrades to the straight-line behaviour that exists
today.**

### 1. The credential never leaves the server

The key lives in the `maps` settings group (ADR-0014 §3): encrypted at rest,
never returned by `GET /settings`, masked in audit.

**Routing is therefore a backend endpoint and not a call from the handset**,
and that is the load-bearing consequence rather than an implementation detail.
A Directions key shipped in a mobile bundle or a browser bundle is
extractable, and this one **bills per request** — a leaked key is somebody
else's traffic on this operator's invoice, and unlike a password there is
nothing to rotate that does not also break the feature for every driver.

It also puts one place between the fleet and the meter. A per-handset
integration has no cache, no ceiling and no way to answer "why was the bill
that size".

### 2. Off by default, and the switch is separate from the key

`maps.routing_enabled` defaults to `false`. Configuring a credential must
never silently start a bill, and an operator must be able to stop the spend
without destroying the credential and having to find it again.

`maps.routing_provider` is an enum whose only member is `google`. Nothing else
is implemented. It exists so the second provider is a value rather than a
schema change — and so that "which engine drew this?" has an answer when a
route looks wrong.

**Self-hosted OSRM was offered and not chosen.** It is free forever and would
have avoided the meter entirely; the owner chose Google for its traffic data
and setup cost. Recorded because the trade was made deliberately, and because
the provider seam is what makes it reversible.

### 3. Every answer is optional, and absence is the normal case

A route is `null` whenever the provider cannot answer: no key, switch off, no
network, a quota rejection, a pair of coordinates with no road between them,
or a trip taken over the phone with no pins at all.

**Null renders as the dashed direct line the app already draws.** Not an
error, not an empty map, not a retry loop. ADR-0023's thesis is that this app
runs where signal does not, and a driver with a passenger in the car needs the
addresses far more than they need a polyline. A routing failure that broke the
screen would be a worse outcome than never having routed at all.

### 4. Requests are cached on a snapped origin

The route from a pickup to a drop-off does not change between requests; the
route from *where the driver is now* changes constantly, and that is what
"recalculate as we go" asks for.

So the cache key is the **destination plus the origin snapped to roughly a
hundred metres** (three decimal places of latitude and longitude), with a
short TTL. A driver crawling through traffic re-asks the same question dozens
of times and pays for it once. A driver who has genuinely moved gets a new
route.

### 5. Recalculation is driven by deviation, never by a timer

The handset asks again when it has moved beyond a threshold from the position
the current route was drawn for — not every N seconds.

The arithmetic is the whole argument. At roughly $5 per 1,000 requests, a
thirty-second timer on a thirty-minute trip is sixty requests, about $0.30 per
trip, and a hundred trips a day is roughly $900 a month — for a route that
does not change while a driver sits at a junction. Deviation-triggered
requests cut that by an order of magnitude and produce a *better* line,
because they fire when the route is actually wrong.

### 6. An ETA may now be shown, and must still be labelled

ADR-0020 §3's refusal is lifted **only where a provider supplied the number**.
A duration that came from Directions is a prediction from real road geometry
and real traffic; it is not the hypotenuse arithmetic that section refused.

Two rules survive it:

- **A provider-supplied duration is shown as an estimate**, never as a promise
  of arrival. It is a forecast, and forecasts are wrong.
- **Nothing derives a duration locally.** If the provider did not send one,
  the screen shows no minutes at all. The moment the app computes minutes from
  a distance it is back to inventing, whatever the distance came from.

### 7. Billing does not change

The **settled** fare still comes from the odometer pair, reconciled against
GPS (ADR-0026 §2). That is the anchor client's evidence and it is not being
replaced by a third party's opinion of how far the road was.

The **estimate** may use road distance where a route exists, because an
estimate from the real road is strictly better than one from a straight line —
ADR-0026 §2 said as much when it declined to add a fudge factor: *"When the
Directions API is wired, this becomes road distance and the estimate becomes
an estimate of the right thing."* This ADR is that moment, and the change is
deliberately staged separately from the map work so a pricing change is never
an incidental effect of drawing a line.

## Consequences

The driver app draws a route that follows roads, states a road distance, and
can show an arrival estimate — the three things every mockup has asked for
since the first screen.

**The platform now has a metered external dependency**, which it did not
before. It is bounded by §2's switch, §4's cache and §5's deviation trigger,
and it is observable because every request goes through one service.

**The straight-line path is not removed and must not be.** It is what runs
with no key, no network and no coordinates — which between them are the
common case, not the edge one.

## Alternatives considered

**Self-hosted OSRM or Valhalla.** Free, no meter, no vendor; weaker traffic
data and a server to run. Offered; the owner chose Google. The provider enum
in §2 is what keeps this reachable later.

**Calling Directions from the handset.** Rejected in §1. It leaks the key,
cannot be cached across drivers, and removes any ceiling on spend.

**Recalculating on a timer.** Rejected in §5, on the arithmetic there.

**Using road distance for the settled fare.** Rejected in §7. The odometer is
the evidence the anchor client is buying.

**Showing an ETA the app computes from road distance.** Rejected in §6, and it
is the failure ADR-0020 §3 was written against — the same invention wearing a
better distance.
