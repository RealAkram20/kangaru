# ADR-0051: The kind of vehicle a client asks for

**Status:** Accepted — 21 August 2026

**Depends on:** ADR-0005 (the fleet is the platform's), ADR-0009 (allocation
contracts outrank), ADR-0020 (the dispatch recommender and its reasons),
ADR-0050 (categories are a table).

**Extends** ADR-0020's scoring without changing any existing term. A booking
that states no preference scores exactly as it did before this ADR.

## Context

The owner: *"the corporate client on the booking page — they should also be
able to select the kind of vehicle they are interested to book. Remember we
have different vehicles."*

Today a booking can say **how many people** are travelling and nothing about
what should collect them. `passenger_count` is a hard filter in
`DispatchRecommender` — a five-seater cannot take eight — and it is the only
thing about the vehicle a client can influence.

That is a real gap, and seats are a poor proxy for it. A bank's transport
officer moving four people to a branch and a bank's transport officer moving
four people plus a cash escort want different vehicles and book identically.
"Four seats" is not the request; "a van" is.

The public walk-in form has had a version of this since ADR-0026 — a customer
picks Economy, Standard, XL, Boda or Electric Boda. **The corporate console,
which is the anchor client's actual surface, has had nothing.**

## Decision

### 1. `bookings.vehicle_category`, nullable, a plain string

Nullable because "no preference" is the ordinary case and the state every
existing booking is in. **Null is a real answer and is never coerced to a
default**: "the client did not mind" and "the client asked for a van and got
a sedan" are different facts, and a bank auditing a trip is entitled to tell
them apart.

A plain string with no foreign key, for ADR-0050 §1's reason: a booking
records what was asked for on a day, and it must keep reading correctly after
the office renames or retires a category.

Validated with `ActiveVehicleCategory`, so a client cannot ask for a
category the fleet does not run. **A retired category is *not* grandfathered
here**, unlike on `UpdateVehicleRequest` — a booking is a request being made
now, not a record that predates the retirement.

### 2. It is a preference, not a filter — and dispatch says which

The owner was shown three rules and chose ranking:

- **Strong preference, said out loud.** A matching vehicle outranks
  everything except a contracted one. When none is free, the others are still
  offered and every mismatched candidate carries the sentence *"Not the van
  the client requested — this is a sedan."*
- A hard filter, like `passenger_count` — rejected: on a thin morning the
  client gets **no candidate at all**, the booking sits, and nothing says
  why. A refusal that produces silence is worse than a ranking that produces
  a choice.
- A hard filter with a dispatcher override — rejected for now as the most to
  build (a permission, a dialog, an audit row, a reason field) for a rule the
  operator has not yet found they need. Recorded here as the escalation if
  they do.

**The number, and why it is that number.** The tiers have to hold
arithmetically, not by intention:

| term | worth |
|---|---|
| contracted to this client (ADR-0009 §1) | 1000 |
| **category match** | **450** |
| proximity, `500 / (1 + km)` | 0 – 500 |
| spare-seat penalty | −20 – 0 |

A contracted vehicle scores at least `1000 − 20 = 980`, so for a contract to
beat every non-contracted vehicle the category bonus must satisfy
`match + 500 < 980`. 450 satisfies it; anything from 480 up does not, and the
rule the owner chose would quietly stop holding.

It is deliberately **not** a total order over distance. A matching van 40 km
away scores `450 + 12 = 462` and loses to a sedan at the kerb on `500`. That
is what "strong preference" means rather than a defect in it: at some
distance the vehicle that can actually arrive is the right answer, and the
reason line says plainly that it is not the one requested.

### 3. Reading the category vocabulary opens to `bookings.create`

The two corporate roles hold `$clientReads` — companies, zones, routes — and
nothing of the fleet, so `GET /vehicle-categories` answered them **403** and
their booking form would have rendered an empty select.

`VehicleCategoryPolicy::viewAny` now also accepts `bookings.create`. This
exposes **names, not the roster**: "Sedan, SUV, Van, Boda" is the platform's
vocabulary, and `docs/security-gate.md` F2's rule — a client sees the vehicle
*on their trip*, never the fleet register — is preserved by withholding the
one field that would break it:

**`vehicles_count` is omitted for any actor without `vehicles.view`.** How
many vans Shanitah owns is roster information and commercially the client's
business not to know. The pricing coverage fields stay, and are already
`forActor()`-scoped, so a client sees their own tariffs named and no others.

### 4. Not built, deliberately

- **The walk-in form is unchanged.** A public customer picks a *ride class*
  (`RideVehicleClass`), which maps to a category in code. Making that mapping
  data is ADR-0050 §7's deferral and is not reopened here.
- **`WalkInRecommender` does not read a category preference.** Order requests
  carry `details.vehicle_class`, which is the customer's vocabulary rather
  than the fleet's, and the two are joined in one place today. Wiring it is a
  separate change with its own mapping question.
- **Nothing refuses a mismatch.** Dispatch will assign a sedan against a van
  request, as it always could; the difference is that the record and the
  candidate list both say so.
- **No notification when the request is not honoured.** The booking carries
  what was asked for, and the office sees it. Telling the client
  automatically is a return-path decision with a cost — it needs a template,
  a trigger and a rule for what counts as a substitution — and it belongs
  with ADR-0039's notification catalogue rather than smuggled in here.

## Consequences

**A client's request is now on the record.** Before this, "we asked for a van
and you sent a saloon" was a conversation with no evidence on either side.
Both halves are now stored: the request on `bookings.vehicle_category`, what
was sent on the trip's vehicle.

**Dispatch behaviour is unchanged for every booking without a preference.**
The new term is inside a null check, so existing rankings, existing tests and
the auto-dispatch path all score exactly as before.

**The recommender's reasons grow by one line, sometimes two.** ADR-0020's
argument for them applies directly: a matcher operators cannot audit is one
they override on instinct, and a substitution nobody can see is exactly the
kind of thing that erodes trust in the ranking.

**A fourth surface now reads the categories endpoint**, and the first one
outside the platform's own staff. That is what made §3's field-level
withholding necessary, and it is worth noticing that widening a policy is
what created the leak risk — the policy change and the resource change are
one decision and must not be separated.

## Alternatives considered

**A free-text "vehicle notes" field on the booking.** Cheapest, and it is
what clients do today inside `notes`. Refused: unstructured text cannot be
ranked, cannot be reported on, and produces "a van", "Van", "VAN please" and
"minibus/van" as four different requests.

**Reusing `RideVehicleClass`** — offering the corporate client Economy /
Standard / XL. Refused: those are a consumer-facing promise about a ride, and
a bank's transport officer thinks in vehicles, not tiers. It would also make
the corporate console depend on a mapping ADR-0050 §7 explicitly left as code.

**A per-client allowed set of categories.** Attractive — a client could be
contracted to vans only. It is genuinely `vehicle_allocations` territory
(ADR-0009), that table already records which vehicles are contracted to whom,
and nothing consults it yet. Building a second, weaker version of the same
idea here would be the wrong place for it.
