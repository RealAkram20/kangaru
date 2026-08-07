# ADR-0021: The geofencing engine

**Status:** Accepted (7 August 2026) · **amended 7 August 2026** with the
billing half — §7–§10 below. The original text said zone pricing was
"deliberately not done yet" because inventing a pricing model there would
have been designing `Modules/Billing`'s next ADR inside this one. It is now
built, and it belongs here rather than in a new ADR: a zone rate is
meaningless without the resolver, and splitting the two across documents
would leave neither answerable on its own.

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

### 7. A zone rate is a complete price, not a multiplier

`rate_card_zone_rates` carries the same five amounts as `rate_card_rates` —
base fare, per kilometre, per waiting minute, minimum, maximum — and
replaces them wholesale for a trip picked up inside the zone.

A zone *multiplier* was the smaller change and is the wrong shape. Operators
price upcountry with a higher base fare and the **same** per-kilometre rate,
or a higher minimum and no other change; a multiplier can only say
"everything here costs 1.2×". It would also have made
`invoice_lines.multiplier_bp` the product of two independent factors —
night × zone — that nobody could decompose from the stored line, which is
the reproducibility requirement AGENTS.md puts on that table.

A *partial* override ("null means inherit") was rejected for the same
reason in miniature: no single row would ever state what a trip in the zone
costs, and reconstructing a disputed price would need two rows and a merge
rule.

The consequence is that zone pricing changed one lookup and four line
descriptions. There is no zone line type, no second multiplier, and
`InvoiceLine::computeAmount()` is still the single definition of a line's
arithmetic.

### 8. The zone selects the rate; it does not add to it

`RateCardVersion::rateFor($category, $zone)` returns the zone's rate when
there is one and the category's default when there is not. Two properties
follow, and both are load-bearing:

- **A rate card with no zone rows behaves exactly as it did before this
  amendment.** Every existing test asserted the same totals afterwards,
  down to the wording of the line descriptions.
- **Drawing a zone can never make a rate card unable to bill.** A pickup
  inside an unpriced zone falls back to the default rate. The alternative —
  refusing — would make a map edit a billing outage.

The zone rate is attached to `rate_card_rates.id`, not to
`(version, category, zone)`. That makes it **structurally impossible** to
price a category in a zone without also pricing it by default: the row has
nowhere to attach. It is the same discipline as §2's named coordinate keys
— a rule that cannot be forgotten beats one that has to be remembered.

Two tables rather than a nullable `zone_id` on `rate_card_rates`, for one
specific reason: **a UNIQUE index treats NULLs as distinct.** Widening the
key to `(version, category, zone_id)` would have let `(v1, sedan, NULL)` be
inserted twice, so the default rate — the one that prices every trip
outside a priced zone — would have lost the only structural protection it
had. Both tables now key on NOT NULL columns.

### 9. `invoice_lines.zone` records the zone whose rate applied

Not the zone the pickup fell in. A trip starting inside a zone the rate
card says nothing about is priced by the default rate and records **no**
zone, because the zone contributed nothing to the amount.

That keeps the column meaning what it has meant since the table existed —
"no zone was applied" — so every invoice issued before this amendment still
reads correctly, rather than becoming ambiguous between "no zone" and "we
did not record it".

`zone_id` is stored beside the name. The name is the snapshot the document
was issued with; the id is what identifies the rate row, since a zone can
be renamed. A test renames and then retires a zone and asserts the issued
invoice still recomputes to the shilling.

Zones are mutable and rate card versions are not, which sounds like a
reproducibility hole and is not: the line stores the *resolved* zone id, so
redrawing a boundary changes what future trips resolve to and cannot move a
number on a document already sent.

### 10. The pricing point is the pickup, and it lives in one place

`Modules\Billing\Pricing\TripZoneResolver` owns the question "which point
prices this trip", separately from `ZoneResolver`'s "which zones is this
point in". It answers: the booking's origin coordinates (ADR-0020).

- It is the location the client agreed to when booking. A surcharge they
  can see coming is a price; one derived from where the journey happened to
  end is a surprise on an invoice.
- It is the same point dispatch ranked drivers against, so "why was this
  trip charged the upcountry rate" and "why was that driver sent" have one
  answer between them.
- It exists at booking time, which is what a future quote needs.

Null is a real answer — no booking (a walk-in raised at the desk), no
coordinates (a phone order, or any booking predating ADR-0020), or no
pricing zone covering the point — and it means "charge the default rate".

**Apportioning distance across zones is deliberately not done.** A trip
that crosses from town to upcountry is priced entirely in its pickup zone.
Splitting the distance line would need the GPS route, a rule for which zone
each segment belongs to, and a way to show a client the split; it is its
own pass, and the schema needs no change to get there — a line already
carries its own zone.

### 11. Zone rates add no endpoint, and no new permission

They ride in on `POST /rate-cards` and `POST /rate-cards/{card}/versions`,
whose policy already confines price-setting to Super Admin and Finance —
the two roles AGENTS.md requires MFA for. A separate zone-rate endpoint
would have been a second door onto the same money with its own policy to
keep in step.

`StoreRateCardVersionRequest` refuses a `zone_id` that is not an **active
pricing or client zone visible to the caller's tenant**, with one message
covering "does not exist", "belongs to another client" and "switched off".
Distinguishing them would confirm that another client's map has something
on it — the same reasoning that makes a cross-tenant read a 404 and never a
403.

The kind check is the one that earns its place: `pricingZoneAt()` only ever
returns pricing and client zones, so a rate on a depot boundary would be
stored, shown on the card, and used by no invoice ever. The version it
lands on is immutable the moment it is created, so the door is the only
place that is still correctable.

`active` is checked at the door and **not** rechecked at pricing time. A
zone switched off after the card was written stops being resolved, so its
rate quietly stops applying and the default takes over — which is right for
an immutable version, and must not be turned into a later map edit
invalidating it.

## Consequences

`ZoneResolver` is now the one place a point becomes a set of zones, and
three callers can share it without drifting. `GET /zones/resolve` answers
"which zones is this in", with `within_service_area` and `pricing_zone_id`
in the meta — the two different questions of "may we take this job" and
"what does it cost".

**ADR-0020's unfixable validation hole is fixed**, by the only mechanism
that could: knowing where the platform operates.

**`Modules/Billing`'s deferred item 3 is closed.** `invoice_lines.zone` is
no longer always null, and `Modules/Billing/README.md` says what it means
now instead of what it is reserved for.

A guard the mutation checks caught: the first draft of the cross-tenant
pricing test asserted that a trip under another client's overlapping zone
fell back to the **default** rate — and it stayed green with
`Zone::scopeVisibleTo` deleted, because the fixture's rate card had no zone
rates either way. The real hazard is not that a competitor's zone gets
charged, it is that a competitor's zone **outranks** the town this client
*is* priced in (client 10 beats pricing 50) and silently drops them to the
default. The test now asserts the town rate still applies, and mutating the
scoping out turns it red.

A second, in an existing guard rather than new code:
`AuditableModelsHaveMorphAliasTest` discovered its models by grepping files
for the literal string `App\Concerns\Auditable`. `RateCardZoneRate`
inherits the trait from an abstract parent and never mentions it, so
removing its morph-map entry left that test green — and an unmapped
auditable model cannot be created at all. The scan now resolves classes and
uses `class_uses_recursive`, which cannot be fooled by where a `use`
statement sits.

A defect the contract test caught: `POST /zones` returned `active: null`
when the request omitted it, because the column's default never reaches the
in-memory model. A client reading the create response would have been told
the zone was switched off while the stored row said otherwise. The
controller now refreshes before serialising.

## What this deliberately does not do yet

**Per-zone distance apportionment.** A trip crossing from town to upcountry
is priced entirely in its pickup zone (§10). Splitting the distance line
across zones needs the GPS route and a way to show a client the split.

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

**A zone multiplier on the rate card version.** Rejected in §7 — it cannot
express the common case, and it makes `multiplier_bp` a product nobody can
decompose from a stored line.

**A nullable `zone_id` on `rate_card_rates` with a widened unique key.**
Rejected in §8 — UNIQUE treats NULLs as distinct, so the default rate would
have lost its duplicate protection.

**Refusing to invoice a trip whose pickup is in a zone the rate card does
not price.** Rejected in §8: drawing a boundary would become a billing
outage for every trip inside it.

**A hardcoded Uganda bounding box** instead of a drawn service area. Simpler
and wrong the day the platform crosses a border; also unable to express the
"we do not serve that district" case an operator actually has.
