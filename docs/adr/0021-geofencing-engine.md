# ADR-0021: The geofencing engine

**Status:** Accepted (7 August 2026)

## Context

PROJECT.md names a Geofencing Engine — *"Town zones, upcountry zones,
client-specific zones, branch boundaries, depot boundaries, service areas.
Automatically determines pricing zone, driver eligibility, and vehicle
eligibility"* — and nothing was built. Three modules had been waiting on it:

- `Modules/Billing/README.md` deferred item 3: *"Zone pricing and the
  geofencing engine. `invoice_lines.zone` exists and is always null."*
- `Modules/Dispatch/README.md` deferred item 2: geofence is listed among the
  dispatch inputs "none of which are consulted; the reference tables they
  need do not exist".
- ADR-0020's consequences recorded a specific, provable hole: **range
  validation cannot catch a swapped Kampala lat/lng.** 0.3476 N / 32.5825 E
  reversed is 32.5825 N / 0.3476 E — a point off the coast of Ghana, with
  *both values inside their valid ranges*. No `between:` rule can see it.

## Decision

### 1. The boundary is JSON, and MariaDB's spatial support is not used

MariaDB 10.4 **does** support `POLYGON` and `ST_Contains` — that was
verified in this environment, not assumed. It is deliberately not used:

1. The frontend needs the ring as data anyway, to draw a zone on a map. A
   geometry column makes every read an `ST_AsGeoJSON` and every write an
   `ST_GeomFromText`, for a shape that is JSON at both ends.
2. Point-in-polygon in PHP is **exactly testable**. Edges, shared vertices
   and concave notches can be asserted against known answers;
   `ST_Contains` correctness depends on SRID and winding-order semantics
   that vary between engines and are harder to pin down.
3. At PROJECT.md's scale — 50 tenants, a few zones each — resolution tests a
   handful of rings in microseconds.

The upgrade path is written down rather than left implicit: when zone counts
reach the thousands, add a `POLYGON` column beside the JSON plus a SPATIAL
index, backfill, and move the filter into SQL. The JSON stays as the
renderable source of truth.

### 2. Points are `{lat, lng}` objects, never positional pairs

GeoJSON orders coordinates `[lng, lat]`. That ordering is the most common
coordinate bug there is, and ADR-0020 records this codebase hitting exactly
that swap. Named keys make it impossible to write silently, at the cost of
being marginally more verbose than a standard nobody reads carefully.

### 3. Geometry lives in a value object, tested on its own

`BoundaryRing` is where the correctness is, so it is tested without a
database: a point in the middle, outside, exactly on an edge, exactly on a
vertex, inside a concave notch, and a ring with a duplicated point (which a
hand-drawn boundary produces easily and which divides by zero if not
special-cased).

Two rules are decided rather than left to floating-point luck:

- **A point on the boundary is inside.** It is genuinely ambiguous, and ray
  casting answers arbitrarily depending on which side the rounding lands.
  For a service area, inside is the kinder answer — refusing an order
  because the pin landed on the line is not something anyone can act on. For
  pricing it makes zone membership deterministic rather than a coin flip.
- **The edge test has a ~1 m tolerance.** A boundary drawn on a map and a
  GPS fix will never agree to the seventh decimal, and a zone whose edge is
  a hairline nobody can land on behaves randomly at its border.

A note for whoever touches the crossing test: `>` and `>=` are *equivalent*
here, and mutating one to the other leaves every test green. That is a real
property of the half-open comparison on a closed ring, not a gap in the
tests — inverting the comparison fails five of them immediately.

### 4. Zones nest, and the narrowest wins

A client's campus sits inside a town, which sits inside the service area.
Rather than making callers order the results, each kind carries a default
priority — client 10, depot 20, branch 30, pricing 50, service area 90 — and
`ZoneResolver::at()` returns them lowest-first. Nobody has to know the
numbers to get the most specific answer.

`Zone` is deliberately **not** `BelongsToTenant`, despite carrying a
nullable `tenant_id`. The global scope would hide every platform zone from a
client, and those are precisely the ones that price their trips. Scoping is
explicit: "the platform's zones plus this client's", never another client's.

### 5. Coverage is opt-in, and silence is the safe default

`withinServiceArea()` returns **true when no service area has been drawn**.
An operator who has not yet mapped their coverage must not have every order
refused, and a validation rule that switched itself on the day somebody
saved their first zone would be worse than no rule. Same discipline as
ADR-0017's rosters: absent means unconstrained.

Once a service area exists, `POST /public/order-requests` refuses a pickup
outside it — which closes ADR-0020's hole. A test asserts the swapped
Kampala pair is now rejected, and that a correct one still goes through.

The guard is silent when the order carries no coordinates at all. A phone
order has none, and refusing what it cannot check would punish the ordering
path for the geocoder's absence.

### 6. Reading is wide, drawing is narrow

`zones.view` is seeded on every system role: dispatch, billing and ordering
all resolve points against zones, and somebody who cannot see a zone cannot
explain why a price or a refusal happened. `zones.manage` sits with
Operations Manager and Super Admin — a boundary decides what a client is
charged, so moving one is a commercial act, not a map edit.

Retiring a zone soft-deletes it. An invoice raised last month recorded the
zone it was priced in, and a hard delete leaves that reference pointing at
nothing.

## Consequences

`ZoneResolver` is now the one place a point becomes a set of zones, and
three callers can share it without drifting. `GET /zones/resolve` answers
"which zones is this in", with `within_service_area` and `pricing_zone_id`
in the meta — the two different questions of "may we take this job" and
"what does it cost".

**ADR-0020's unfixable validation hole is fixed**, by the only mechanism
that could: knowing where the platform operates.

A defect the contract test caught: `POST /zones` returned `active: null`
when the request omitted it, because the column's default never reaches the
in-memory model. A client reading the create response would have been told
the zone was switched off while the stored row said otherwise. The
controller now refreshes before serialising.

## What this deliberately does not do yet

**Zone pricing.** `invoice_lines.zone` is still null. The resolver can now
answer which pricing zone a trip started in, but rate cards have no
zone-rate rows and inventing a pricing model here would be designing
`Modules/Billing`'s next ADR inside this one.

**Dispatch eligibility by zone.** `DispatchRecommender` does not yet filter
or weight by geofence. It is an additional input to the existing scorer
rather than a rewrite, and it belongs with branch and depot — which have no
reference tables (`Modules/Fleet/README.md` item 7).

**Zone-drawing UI.** Boundaries arrive as JSON through the API. A map editor
is real work and its own pass; the ring format was chosen so that work needs
no migration.

**Caching.** `ZoneResolver` reads active zones per call. The docblock
describes a cache and there is none — at current scale the query is trivial,
and a cache with no invalidation story is worse than a query. Named here so
the docblock's ambition is not mistaken for a claim.

## Alternatives considered

**A `POLYGON` column with a SPATIAL index.** Available and rejected in §1 —
the frontend needs the ring as data, and PHP geometry is exactly testable.

**GeoJSON positional pairs.** Standard, and the source of the exact bug this
ADR exists partly to catch.

**Refusing orders whenever a pickup falls outside every zone.** Rejected in
§5 — it would break every operator who has not finished mapping, and would
switch on silently.

**A hardcoded Uganda bounding box** instead of a drawn service area. Simpler
and wrong the day the platform crosses a border; also unable to express the
"we do not serve that district" case an operator actually has.
