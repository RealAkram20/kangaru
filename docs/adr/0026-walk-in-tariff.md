# ADR-0026: The walk-in tariff

**Status:** Accepted (9 August 2026)

**Depends on:** ADR-0024 (walk-in fulfilment, which deferred pricing by
name), ADR-0021 (zone pricing), ADR-0005 (platform-owned rows carry a null
tenant), ADR-0020 §3 (ranking is straight-line, and why that matters here).

## Context

ADR-0024 shipped hailing and left the money out, in as many words:

> **Billing has a customer-owned trip it has never seen.** `invoices` are
> tenant-owned; a walk-in's fare is not an invoice to a corporate account.

The owner's requirement is the ordinary one for a hailing operator: **the
system works out the distance and charges per kilometre**, and the rate
differs by vehicle — a boda is not a Premio is not a Hiace.

Almost all of that already exists. `rate_card_rates` is keyed on
`vehicle_category` and carries `base_fare_minor`, `per_km_minor`,
`per_waiting_minute_minor`, a minimum and an optional maximum; ADR-0021
added per-zone overrides on top; and `TripPricingEngine` is pure — it reads a
trip and a version and returns priced lines, writing nothing.

One thing is missing, and it is ownership rather than arithmetic.
`rate_cards.tenant_id` is a non-nullable foreign key to a client, and
`RateCardResolver::defaultCardForTenant()` finds the default card through
`TenantScope`. A walk-in trip has no tenant, so **there is no card it could
possibly resolve** — the pricing engine would price it perfectly if only
something could hand it a version.

## Decision

### 1. The tariff is a rate card with no tenant

`rate_cards.tenant_id` becomes nullable, and a card with a null tenant is
the platform's public tariff. Its versions and rates follow, since both
carry the same column.

This is not a new idea in this schema; it is the fourth time. `drivers`,
`vehicles`, `order_requests`, `customers` and now `trips` all carry a null
tenant to mean "the platform's, not a client's" (ADR-0005). A separate
`walk_in_tariffs` table would have been a second, parallel definition of
what a price is — a second versioning story, a second zone override, a
second `rateFor()` — and the two would drift the first time somebody changed
one. The pricing engine reads a `RateCardVersion`; the honest way to price a
walk-in is to give it one.

**Versioning and immutability are inherited, not re-argued.** A published
tariff version is frozen once used, exactly like a client's, so a fare can
always be re-derived from stored data — which is the whole point of
AGENTS.md's versioning rule and the reason a dispute has an answer.

### 2. Distance is measured, then charged — and which distance depends on when

Two different numbers, because a passenger asks the question twice.

**Before the ride**, there is no trip and no route: only a pickup and a
drop-off. The estimate uses the great-circle distance between them
(`GreatCircle`, shared with the matcher since ADR-0024) and is **labelled an
estimate everywhere it appears**. ADR-0020 §3 already refused to promise an
ETA from a straight line, and this is the same limitation: real roads are
longer than the crow's flight, so this number is a floor rather than a
prediction.

There is deliberately **no fudge factor**. A 1.3× "road winding" multiplier
would turn a measurable quantity into a guess wearing a decimal point, and
the first time a passenger compared two apps the invented number is the one
that would need defending. When the Directions API is wired, this becomes
road distance and the estimate becomes an estimate of the right thing.

**After the ride**, `TripStateMachine` already computes `distance_km` at Trip
Completed from the opening and closing odometer, and reconciles it against
the GPS route. That is the number that is charged, and it is evidence — two
independent sources that must agree, which is what the anchor client is
buying. Nothing about that changes here.

So: the estimate is honest about being one, and the fare is measured.

### 3. The fare is computed, and it is not an invoice

`TripPricingEngine` prices the completed trip through the platform tariff,
and the result is stored on the trip.

It is **not** written to `invoices`. That ledger answers "what does this
client owe", is keyed per tenant, and carries a document number series a
walk-in has no place in — `InvoiceService` already refuses a walk-in trip
with its own error code for exactly this reason (ADR-0024). A cash fare in
a taxi is not an invoice, and making it one would put a stranger's
fifteen-thousand-shilling ride into the same ledger a bank reconciles
against.

**Settlement stays deferred** — cash, mobile money, a receipt, a refund.
This ADR computes what is owed and records it. Who collected it, in what
form, and what happens when they did not, is a payments decision nobody has
made, and inventing a `paid` boolean now would be the guess ADR-0024 avoided.

### 4. Who may set it

`rate_cards.manage`, held by platform staff only.

The permission already exists and the policy already checks it; what changes
is that a card with no tenant is reachable only by an actor with no tenant.
A Corporate Admin holding `rate_cards.manage` for their own account must not
be able to edit the public tariff — their grant is over their client's
prices, and ADR-0006's `forActor` split is the existing expression of that
difference.

## Consequences

A walk-in ride has a price, computed from the same engine, the same
versioning and the same zone overrides that price a bank's. Setting the
public tariff is the rate-card screen an operator already knows.

**A category with no rate refuses rather than guesses.** `RateCardResolver`
throws `RateCardNotConfiguredException::categoryNotPriced` today and will
here too — so a boda dispatched before anybody priced bodas produces a loud
failure at completion rather than a silent zero. That is the right
direction: a fare of zero looks like a free ride and is discovered by
reconciliation weeks later.

**The estimate can be wrong, and low.** Straight-line distance under-reads
against real roads, so a quoted figure will generally be below the fare
charged. The screen says "estimated" and says the final fare follows the
distance actually travelled — wording the ride screen already carries for
its simulated estimate.

## What this deliberately does not do

**Surge or demand pricing.** Nothing here reads how many drivers are on duty
against how many orders are waiting. It is the obvious next lever and it is
a commercial decision with a reputational cost attached, not an engineering
one.

**Per-driver or per-vehicle pricing.** The rate is per *category*, as it has
always been. A driver who wants to charge more than the tariff is not a
thing this platform models.

**Cancellation charges.** `trips.cancellation_charge_applicable` is a column
the state machine sets and nothing prices, which was true before this ADR and
is still true after it. ADR-0024 recorded why: who pays what when a customer
cancels ninety seconds before pickup is undecided.

## Alternatives considered

**A `walk_in_tariffs` table of its own.** Rejected in §1 — a second
definition of what a price is, drifting from the first.

**A pseudo-tenant to hang the public tariff on.** Rejected for the third
time in this codebase, for the reason ADR-0012 gave and ADR-0024 repeated: a
fake client row that every screen must learn to hide.

**Charging the estimate rather than the measured distance.** Simpler, and
wrong in the direction that matters: it would bill a straight line for a
journey round a lake, and the platform holds odometer and GPS evidence of
the real distance precisely so it does not have to guess.