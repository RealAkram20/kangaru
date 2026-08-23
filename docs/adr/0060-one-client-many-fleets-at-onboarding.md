# ADR-0060: One client, many fleets — at onboarding

**Status:** Accepted — 22 August 2026

**Depends on:** ADR-0055 §6 and package `F2` (a client may contract more than
one fleet; `operator_client` exists and already carries a per-fleet credit
limit and billing email).

**Companion to:** ADR-0058, ADR-0059.

**Amended by ADR-0062 (23 August 2026)** in one respect: §5's *"Not Kangaru"*
and the Consequences' *"Kangaru does not approve client onboarding"* are about
**approving a second fleet joining an existing client**, and they stand. They
were written as though head office had no onboarding role at all, and that is
now false — **head office may create a corporate client, naming the fleet that
will serve them.** Path B, the `requested` status and the client's approval are
unchanged.

## Context

ADR-0055 settled that a corporate client may be served by several fleets, and
`F2` built the join that expresses it. What neither settled is **who creates
the client row**, and that turns out to be where the whole model can break.

The owner, 22 August 2026:

> each Fleet company can onboard it's own coporate company but still these
> coporate company can be served by different Fleet companies

Shanitah signs Centenary Bank. Six months later a second fleet also signs
Centenary Bank. If each fleet creates its own client row, the bank ends up
with:

- two logins, and staff who cannot see half their own trips;
- two trip histories that no report can reconcile;
- two sets of invoices, from an organisation that believes it has one supplier
  relationship per fleet and one identity;
- and two `tenant_id`s, which means the isolation model is working perfectly
  and keeping the bank's data from itself.

**No merge afterwards is clean.** Trips carry `tenant_id`; so do bookings,
invoices, routes, places and users. Merging two clients means rewriting the
column the entire isolation model rests on, in production, across nine tables.

### The database currently permits the duplicate

`companies.registration_number` exists and is **nullable and not unique**.
`companies.tenant_id` is unique, but that is one company row per client — it
does not stop two clients being created for one real-world company.

So today two fleets can both create "Centenary Bank Ltd" and nothing objects.

### Why a name cannot be the key

"Centenary Bank", "Centenary Bank Ltd", "Centenary Rural Development Bank Ltd"
and "CENTENARY BANK LIMITED" are one organisation and four strings. Fuzzy
matching either produces false positives — blocking a genuinely new client
because its name resembles an existing one — or false negatives, which is the
duplicate this ADR exists to prevent. Neither failure is acceptable in a path a
fleet's sales team runs unsupervised.

## Decision

### 1. The registration number is the platform-wide identity of a client

`companies.registration_number` becomes **required at onboarding and unique
across the platform**. It is the company registration or TIN — a value the
state issues, that the client already knows, and that does not vary by
spelling.

Existing rows: **require it on next edit; do not invent one.** A backfill that
generates placeholder numbers would populate the uniqueness key with values
that are unique and meaningless, which is worse than null. New onboarding is
blocked without it from the day the migration lands.

### 2. The number is asked for first, and nothing else is enabled until it is answered

Not a field among fields — **the first field, with the rest of the form
disabled behind it.**

This is deliberate friction in the one place friction is cheap. A form that
asks for the number last is a form where a sales user types the client's whole
profile, hits save, and is told the company already exists — at which point the
pressure to work around the check is at its maximum, and the easiest workaround
is a slightly different name.

### 3. The lookup answers a boolean and nothing else

```
GET /clients/lookup?registration_number=…  →  { "exists": true|false }
```

No name. No address. No contact. No status. No count. **No indication of which
fleet, or how many fleets, serve them.**

*"Is Centenary on Kangaru?"* is not a question one fleet may ask about another
fleet's client, and a lookup that leaks the answer turns the onboarding form
into a competitor-intelligence tool. A fleet that holds a client's TIN learned
it from that client.

The endpoint is exact match only. There is no search, no prefix, no listing,
and no rate at which it becomes an enumeration oracle — a TIN is not guessable
in the space of a rate limit, but the endpoint is rate-limited anyway.

### 4. Two paths, and only one of them creates anything

**Path A — no match.** The fleet creates, in one transaction: the client, its
contract (`operator_client`, status `active`, `started_on` today), and the
client's first administrator account with an invitation to set their own
password. The fleet's credit limit and billing email go **on the contract, not
on the client** — that is what makes the second fleet possible later.

**Path B — match.** The fleet may **only ask**. A contract row is written with
status `requested`, and:

> **A `requested` contract grants no read whatsoever.**

Not the client's name, not their trips, not their staff, not their existence
beyond the boolean the fleet already had. It is a request sitting in a queue,
and it confers nothing until it is answered. This is the single most important
sentence in this ADR: if `requested` grants any read at all, then any fleet
holding any TIN can read any client, and the whole isolation model is defeated
by a form.

### 5. The client approves. Not Kangaru, and not the incumbent fleet

The bank decided to hire a second fleet, so the bank confirms it — in its own
console, under *Our fleets*.

- **Not Kangaru**, because head office would become a bottleneck on every
  fleet's sales cycle, and because Kangaru has no view on whether a bank wants
  a second supplier.
- **Not the incumbent fleet**, obviously — a competitor does not get a veto on
  their client's suppliers, and asking would itself disclose the request.

The client sees who is asking. That disclosure is one-directional and correct:
the requesting fleet identifies itself to the client it is asking to serve, and
learns nothing in return until the answer comes.

### 6. What is shared, and what stays separate

Once two contracts are active on one client:

| Shared — there is one bank | Per fleet — one row each in `operator_client` |
|---|---|
| Identity: legal name, registration number, address | Credit limit |
| Its people (`users`) and their capabilities | Billing email |
| Saved places and client routes | Rate card in force |
| The trip history *as the client sees it* | Invoice number series |
| | Its own trips, bookings and invoices |

**Neither fleet sees the other's work for that client.** The client sees both,
and is the only party from which the whole relationship is visible — which is
correct, because it is the only party the whole relationship belongs to.

### 7. A contract ends without ending the client

Leaving sets `ended_on` on that fleet's own contract row. The client keeps its
account, its people and its history with the remaining fleet. The departing
fleet keeps its completed trips and invoices — it needs them for its own books
— and loses every live read.

`operator_client` already restricts on delete for the operator side. A client
is never deleted by a fleet leaving, and a fleet is never deleted while
contracts reference it.

## Consequences

- **Package `K5`** lands the migration, the backfill decision and the lookup.
  **Package `K6`** lands both paths, the `requested` status, and the client's
  approval screen.
- **`K6`'s exit criterion is a refusal test**, not a feature test: a fleet
  holding a `requested` row must read nothing of that client, proved by
  assertion and proved by mutation.
- **The client console gains *Our fleets*** (ADR-0059's client menu). Without
  it the approval has nowhere to happen.
- **Path B is built even though there is one fleet today.** It is the rule that
  prevents the duplicate, and retrofitting it after two banks exist is the
  expensive version — see Context.
- **`docs/corporate-client-panel-plan.md` is amended**: Centenary is onboarded
  by a fleet, not by Kangaru.
- **The data inventory gains a row.** A registration number is company data,
  not personal data, but the lookup endpoint is a new disclosure surface and
  belongs in the register (`docs/data-inventory.md`).

## Alternatives considered

**Let each fleet hold its own client row, and reconcile in reporting.** The
cheapest build and the one that quietly destroys the product: the bank's own
staff would see half their trips, and no reporting layer can fix a split
identity at the point where a user logs in.

**Kangaru creates all clients; fleets request them.** Safe, and it makes head
office a gatekeeper on every fleet's sales cycle — the opposite of a platform.
Rejected in §5.

**Match on name with a review queue.** Turns every onboarding into a manual
decision made by somebody with no way to check, and the queue becomes a rubber
stamp within a month.

**The incumbent fleet approves the second.** Rejected in §5: a competitor with
a veto, and the request itself is a disclosure.

**Let the second fleet see the client's basic details before approval, to
confirm they have the right company.** Superficially reasonable — and it is
exactly the leak §3 and §4 exist to prevent. The fleet already knows which
company it means; it has their TIN. It does not need Kangaru to confirm it.
