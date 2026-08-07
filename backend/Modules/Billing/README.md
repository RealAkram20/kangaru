# Billing

## Purpose

Turns a completed trip into a priced, reproducible, immutable invoice.

This is the module AGENTS.md is strictest about — "The platform's credibility
lives or dies on billing correctness. These rules are absolute." — and the one
PROJECT.md names as risk #2: *"Billing correctness dispute with the anchor
client."* Everything below is shaped by that: the module would rather refuse
to bill a trip than guess at a price, and would rather issue a credit note
than change a number a client has already seen.

## Responsibilities

**Rate cards** — a named pricing agreement (`RateCard`), carrying immutable
priced revisions (`RateCardVersion`) that price each vehicle category
(`RateCardRate`) and, optionally, that category inside one zone
(`RateCardZoneRate`). Prices never change; a card gains a new version and
every invoice keeps pointing at the version it was raised under.

**Pricing** (`Modules/Billing/Pricing`) — pure computation, writes nothing.
`RateCardResolver` picks the version in force on the trip's start date,
`WaitingTimeCalculator` derives waiting minutes from the `trip_events`
timeline, and `TripPricingEngine` produces the priced lines.

**Invoicing** (`InvoiceService`) — one transaction that allocates a number
from the locked counter, writes the invoice and its lines, seals the rate
card version, and moves the trip to `Invoice Generated`. Idempotent.

**Corrections** (`CreditNoteService`) — the only mechanism for changing what
a client owes. There is deliberately no editing path for it to compete with.

## How the AGENTS.md money rules land in code

| Rule | Where |
|---|---|
| Integer minor units, never floats | every `*_minor` column; UGX is zero-decimal so one minor unit is one shilling |
| A money value object, no raw integer math outside it | `App\Support\Money\MoneyMinorCast` casts every money column to `Brick\Money\Money`; `$rate->per_km_minor * $km` is a TypeError |
| Rounding rule per rate card, stored on the line | `RateCardVersion::$rounding_mode`, copied to `invoice_lines.rounding_mode` |
| Lines store every input; invoices fully reproducible | `invoice_lines` stores the inputs as typed columns, not a JSON blob; `InvoiceLine::recompute()` re-derives the amount from them and a test asserts it agrees |
| Rate cards versioned, immutable once used | `RateCardVersion` refuses every update except the one that stamps `locked_at` |
| Idempotent generation | required `Idempotency-Key`, plus unique indexes on `(tenant_id, idempotency_key)` and `trip_id` |
| Sequential per-tenant numbers under a locked counter | `DocumentNumberSequenceRepository` |
| Corrections are credit notes, never edits | `Invoice`, `InvoiceLine`, `CreditNote`, `CreditNoteLine` all throw on update and delete |
| Audit log over rate cards and invoices | `Auditable` on `RateCard`, `RateCardVersion`, `RateCardRate`, `Invoice`, `CreditNote` |

## How a trip is priced

Order is fixed, and is the invoice's own reading order:

1. **Base fare** × night multiplier
2. **Distance** (`trips.distance_km`, from the odometer readings) × night multiplier
3. **Waiting time** — billable minutes × per-minute rate, never multiplied
4. **Minimum or maximum charge adjustment** against the sum of 1–3

Three decisions worth knowing:

- **The night rate is a multiplier on lines, not a separate surcharge line.**
  Every line's amount is `unit × quantity × multiplier_bp / 10000`, one
  formula (`InvoiceLine::computeAmount()`) that both the engine and
  `recompute()` call. A surcharge line would have needed a second shape and
  a second meaning for `multiplier_bp`.
- **Waiting is never multiplied.** The night rate prices a journey driven at
  an unsociable hour; a vehicle standing still costs the same per minute
  whenever it happens, and stacking a surcharge on a per-minute charge is
  the kind of double-counting a client queries.
- **Minimum and maximum are adjustment lines, not a rewritten total.** The
  arithmetic on the issued invoice has to add up, and "which rule moved this
  number?" has to be answerable from the document.

Waiting minutes come from `trip_events` (AGENTS.md: "never from a mutable
column"). Seconds are summed across every pause and truncated to minutes
**once, at the end** — truncating each pause separately systematically
under-bills a trip that waited three times.

## Zone pricing (ADR-0021, billing half)

A rate card version can price a vehicle category differently inside a zone.
`RateCardZoneRate` carries the **same five amounts** as the default rate and
replaces them wholesale — it is a complete price, not a multiplier and not a
partial override. Four decisions are worth knowing:

- **The zone selects a rate row; it never adds a line or a multiplier.**
  `TripPricingEngine` resolves the zone once and asks
  `RateCardVersion::rateFor($category, $zone)` for the prices. Everything
  downstream — rounding, the night multiplier, minimum and maximum
  adjustments — is untouched, and `InvoiceLine::computeAmount()` is still the
  only definition of a line's arithmetic.
- **A zone rate hangs off `rate_card_rates.id`.** Pricing a category in a
  zone without pricing it by default is not refused by a validation rule; it
  has nowhere to be written. And two tables rather than a nullable `zone_id`
  because a UNIQUE index treats NULLs as distinct — one table would have let
  the default rate be inserted twice.
- **`invoice_lines.zone` records the zone whose rate *applied*.** A trip
  picked up inside a zone this card says nothing about is priced by the
  default rate and records no zone, because the zone contributed nothing to
  the amount. Null keeps the meaning it carried on every invoice issued
  before this existed. `zone_id` sits beside the name because a zone can be
  renamed and a name cannot identify the rate row.
- **The point is the pickup**, from the booking's coordinates.
  `Pricing\TripZoneResolver` owns that choice and its three "no zone" cases —
  no booking, no coordinates, no pricing zone — all of which mean "charge the
  default rate" rather than "refuse".

`StoreRateCardVersionRequest` accepts a zone rate only for an **active
pricing or client zone visible to the caller's tenant**, with one message for
"does not exist", "another client's" and "switched off" — distinguishing them
would confirm another client's map exists. `active` is checked there and
deliberately not rechecked at pricing time: switching a zone off stops it
resolving, so its rate stops applying, without invalidating an immutable
version.

## Concurrency

Invoice generation is **serialised per tenant**, by taking the tenant's
counter row lock as the first statement in the transaction.

That is a stronger lock than "protect the counter", and it is deliberate.
Everything else invoice generation touches — the invoice for this trip, the
invoice for this idempotency key — is a row that does not exist yet, and
locking reads on absent rows take gap locks that two concurrent generators
deadlock on the moment both insert. Serialising up front means nothing
downstream is contended at all. A gapless sequence is inherently serial
anyway, and invoicing is a month-end batch, not a request hot path.

The counter row is created *before* the transaction opens, not inside it.
Inside, two simultaneous first-ever invoices deadlock on `INSERT IGNORE`
against the unique index — one has to take a shared lock on the other's
uncommitted row while holding an insert-intention lock it needs. That was
observed, not theorised: `InvoiceNumberRaceTest` reported
`SQLSTATE[40001] ... Deadlock found` on its first run.

## Dependencies

- `Modules\Trips` — `Trip`, `TripEvent`, `TripStatus`, `TripStateMachine`.
  Billing depends on Trips; Trips does not depend on Billing.
- `Modules\Vehicles\Models\Vehicle` — for `Vehicle::CATEGORIES` and a trip's
  category at pricing time.
- `Modules\Fleet` — `Zone` and `ZoneResolver`, for zone pricing. Billing
  depends on Fleet; Fleet does not depend on Billing.
- `App\Support\Money\{Shillings, MoneyMinorCast}`, `App\Concerns\{Auditable,
  BelongsToTenant}`, `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode`.
- `brick/money` (and `brick/math`), added by this module.

`Modules/Reports` depends on Billing, read-only: its financial report
aggregates `invoices` and `credit_notes` by period. Billing does not depend
on Reports. Nothing else depends on Billing.

## Public APIs

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/rate-cards` | `viewAny` — Super Admin, Finance, Operations Manager, Corporate Admin |
| POST | `/api/v1/rate-cards` | `create` — **Super Admin, Finance only** |
| GET | `/api/v1/rate-cards/{rateCard}` | `view` |
| POST | `/api/v1/rate-cards/{rateCard}/versions` | `update` — Super Admin, Finance only |
| PUT | `/api/v1/rate-cards/{rateCard}/default` | `update` — Super Admin, Finance only |
| GET | `/api/v1/invoices` | `viewAny` — Super Admin, Finance, Operations Manager, Corporate Admin |
| GET | `/api/v1/invoices/{invoice}` | `view` (route key is the **uuid**) |
| POST | `/api/v1/trips/{trip}/invoice` | `create` — **Super Admin, Finance only** |
| GET | `/api/v1/invoices/{invoice}/credit-notes` | `view` on the invoice |
| POST | `/api/v1/invoices/{invoice}/credit-notes` | `credit` — **Super Admin, Finance only** |

There is no `PATCH` or `DELETE` anywhere in this module. That is the design,
not an omission, and `RateCardTest` asserts it so that adding one later is a
deliberate act with a failing test attached.

`POST /api/v1/trips/{trip}/invoice` requires an `Idempotency-Key` header
(8–128 chars; a body field is accepted as a fallback). The server does not
invent one: a server-side default cannot distinguish "the network dropped my
response, retry" from "bill this trip again", which is the only thing the
mechanism is for. It returns **201** for a new invoice and **200** for a
replay, with the same body either way.

### Error codes

| Code | Status | Meaning |
|---|---|---|
| `RATE_CARD_NOT_CONFIGURED` | 422 | no default card, no version in force on the trip date, or the vehicle's category is not priced |
| `TRIP_NOT_INVOICEABLE` | 409 | the trip is not at `Trip Completed` |
| `TRIP_ALREADY_INVOICED` | 409 | already billed, under a different idempotency key |
| `IDEMPOTENCY_KEY_REUSED` | 409 | that key belongs to a different trip's invoice, or a different invoice's credit note |
| `CREDIT_NOTE_EXCEEDS_INVOICE` | 422 | the running credit total would exceed what the invoice charged |

## Effect on Modules/Trips

`Invoice Generated` is no longer reachable over HTTP.
`TransitionTripRequest` rejects it with a 422, and `TripPolicy` no longer
lists it for Finance. `InvoiceService` applies it inside the transaction
that issues the invoice.

Without that, a trip could be marked billed with no invoice behind it —
and, because billing only accepts a trip at `Trip Completed`, one that
could never be billed afterwards either. It is a 422 rather than a 403
because nobody may do it, so it is not a question of permission.

## What's explicitly deferred

Everything here is *not built*, not "partly built".

1. **Payments, statements, outstanding balances and credit limits.** Nothing
   records money coming in. `Company::$credit_limit_minor` exists and is
   read by nothing. An invoice's `balance` is issued-total-less-credits, not
   less-payments. `Modules/Reports`' financial report inherits this exactly:
   its "Outstanding" is the same figure, and it carries a
   `payments_recorded: false` flag so every surface that renders it can say
   so rather than let a bank read it as "unpaid".
2. **Monthly consolidated invoicing.** One invoice per trip. PROJECT.md wants
   monthly billing; that makes `invoices.trip_id` nullable with a line-level
   trip reference, which is additive per the zero-downtime rule.
3. **Per-zone distance apportionment.** Zone pricing itself is built (see
   below); what is not is splitting one trip's distance across the zones it
   crossed. A trip is priced entirely in its pickup zone. Apportioning needs
   the GPS route, a rule for which zone each segment belongs to, and a way
   to show a client the split — and no schema change, because a line already
   carries its own zone.
4. **Weekend and holiday rates.** Night rates are in (a time window needs no
   calendar); these need a holiday calendar that does not exist.
5. **Cancellation and no-show charges.** AGENTS.md makes both rate-card
   driven, and `trips.cancellation_charge_applicable` is already captured —
   but `Cancelled` and `No Show` are terminal states that cannot reach
   `Invoice Generated`, so billing them needs a state-machine change. No
   rate card columns were added for charges nothing computes.
6. **Tax/VAT, discounts, additional charges, contract pricing.** PROJECT.md's
   Billing Engine lists all four. None exist.
7. **Multi-currency.** `config/money.php` is a platform constant. Financial
   records still store their own `currency`, so the day it arrives, history
   is not ambiguous about what its integers meant.
8. **A PDF invoice document.** Invoices are JSON. `Modules/Reports` has a
   PDF writer that a future financial report can reuse.
9. **Payment recording in the UI.** The Invoices page shows
   issued-less-credited as "Outstanding" and says so on the tile, because
   there is nothing else it could honestly mean until payments exist.
10. **MFA on the roles that can move money.** `InvoicePolicy` and
    `RateCardPolicy` already confine issuing, crediting and rate-setting to
    Super Admin and Finance — the two roles AGENTS.md requires MFA for. The
    authorization boundary is right; the second factor is a known
    platform-wide gap and will sit on top of it.
11. **Per-tenant billing timezones.** `config/billing.php` is global; every
    Phase 1 tenant operates in Uganda.
12. **Rate card archival.** `RateCardStatus::ARCHIVED` exists and is never
    set by any route — a card is created active and stays active.
13. **Rate cards are not open to platform staff, and that is deliberate.**
    ADR-0006 opened the *invoice* listing to Shanitah's Finance officer
    (`InvoiceRepository::listing()` takes the actor), because Decision 3
    names that case and invoice generation already binds the trip's tenant.
    Rate cards were left alone: `POST /rate-cards` has no subject
    parameter, so a platform actor creating one would write a tenant-less
    card that prices nothing. Opening the read without the write would ship
    a half-working screen. Which client a platform-authored rate card
    belongs to is a product question, unanswered.
14. **No cross-client invoice run.** One invoice per trip means there is no
    endpoint that could silently become cross-client — the hazard ADR-0006's
    Consequences names. It reappears the day monthly consolidated invoicing
    (item 2) is built, and that build has to answer it.

## Frontend

- `frontend/src/pages/RateCardsPage.tsx` — cards, their version history, and
  the per-category prices of each version. A version shows whether it is
  **sealed** (an invoice has cited it) before it shows anything else, because
  that is the fact that decides whether it can still be superseded quietly.
  There is no edit control anywhere on the page and no route behind one.
- `frontend/src/pages/billing/RateCardVersionDialog.tsx` — one dialog for
  both "new card" and "new version", because the payload is the same shape
  and the backend shares one rule set. The night multiplier is typed as
  `1.25` and converted to basis points once, on submit, so a float never
  reaches storage. Zone prices sit inside the category they override,
  mirroring the storage and the request body; the picker offers only the
  zones `priceableZones()` would accept, so the 422 is a backstop rather
  than the first anybody hears of it. If `/zones` cannot be read at all the
  section explains its own absence and ordinary prices can still be set —
  zones refine a rate card, they are not a prerequisite for one.
- `frontend/src/pages/InvoicesPage.tsx` and `billing/InvoiceDetail.tsx` —
  the list with cursor paging, and one invoice's lines with the inputs that
  produced them. The multiplier column is rendered for every line, including
  the ones no multiplier touched.
- `frontend/src/pages/billing/CreditNoteDialog.tsx` — the correction path.
  Its remaining-balance check is a courtesy that catches the mistake before
  a round trip; it cannot see a note a colleague is issuing right now, so a
  422 `CREDIT_NOTE_EXCEEDS_INVOICE` is still surfaced rather than swallowed.
- `frontend/src/pages/trips/InvoiceTripDialog.tsx` — "Generate invoice" on a
  completed trip.

Two details worth keeping:

**Idempotency keys are minted per dialog, not per click.** A key identifies
one intended mutation, so the same dialog retrying after a dropped response
sends the same key and gets the original invoice back. Minting a new key on
each click would turn a retry into a second billing attempt — which the
server refuses, but for the wrong reason and with a confusing message.

**The Trips page no longer offers `Invoice Generated` as a transition.**
`TripTimeline` filters it out of `allowed_transitions` and shows "Generate
invoice" instead. It is still a legal next state, so the API keeps serving
it in that array — but it is not one a client may ask the transitions
endpoint for, and a button that always 422s is worse than no button.

Actions that move money are hidden from roles that cannot perform them
(`canManageBilling` in `frontend/src/lib/billing.ts`). That is convenience,
not authorization — AGENTS.md is explicit that frontend permissions are
never relied on alone, and every endpoint answers 403 independently. A role
that cannot read invoices at all gets an explanation rather than a red error
it can do nothing about.

## Notes on the tests

`tests/Concurrency/InvoiceNumberRaceTest.php` is the numbering equivalent of
the AGENTS.md-mandated dispatch race test. Two OS processes, released at the
same wall-clock instant, both invoicing. **Unlike the dispatch race, both
must succeed** — nothing is contended except the counter, and a finance user
whose invoice fails because a colleague was billing a different trip would
be a bug, not a safeguard. It asserts consecutive numbers, no duplicate, no
gap.

It has been verified to fail with `lockForUpdate()` removed from
`DocumentNumberSequenceRepository::lockSeries()`: both processes read
`next_number = 1` and one dies with a deadlock on the counter update, so the
test reports one winner instead of two. Re-run that check if you touch that
repository — a numbering test that passes without the lock proves nothing.

Its second case (two simultaneous replays of one key) is guarded by the
trip row lock and the unique indexes, **not** by the counter lock, and does
still pass without it. It is not evidence about the counter.

Four other guards were verified the same way — each was removed, and the
suite failed:

| Guard | Test that fails without it |
|---|---|
| `RoundingMode::toBrick()` mapping each rule to its own constant | "separates half-up from half-down on an exact tie" |
| `WaitingTimeCalculator` truncating once, not per pause | "sums waiting seconds across pauses before truncating to minutes" |
| `CreditNoteService::assertWithinInvoice()` | all of `CreditNoteTest` |
| `InvoiceService` idempotency replay | "returns the original invoice on a replay of the same idempotency key" |
| `RateCardVersion` immutability | "refuses every attempt to edit a rate card version or its rates" |

`ZonePricingTest` was mutation-checked the same way, and one of those checks
found a false green worth recording. Its cross-tenant case originally
asserted that a trip under another client's overlapping zone fell back to
the **default** rate — and it stayed green with `Zone::scopeVisibleTo`
deleted, because the fixture had no zone rates either way. The real hazard
is that another client's zone *outranks* the town this client is priced in
(client 10 beats pricing 50) and silently drops them to the default. The
test now asserts the town rate still applies, and the mutation kills it.

Each filter in `StoreRateCardVersionRequest::priceableZones()` — active,
kind, tenant visibility — is a separate test rather than one loop, so
removing any one of them names which rule stopped holding.

`BillingCrossTenantIsolationTest` is the ADR-0001 mandatory isolation proof.
It exists separately from the other modules' because a leak here is another
client's *money* — their prices, their totals, their disputes — and because
both tenants' first invoice is numbered `...000001`, so a test asserting on
invoice numbers alone would pass straight through a leak. It asserts on
uuids and on row counts.

Since ADR-0006 it has a **mirror**, and this module is where that mirror
bites hardest: `tests/Feature/Tenancy/PlatformStaffIsolationTest.php` proves
a platform **Dispatcher** — who belongs to no tenant and therefore reads
every client's bookings and trips — is still refused the invoice listing,
a single invoice by uuid, and the rate cards. A platform **Finance officer**
is shown all of it, because they hold `invoices.view` and the dispatcher
does not.

That pairing is the whole decision in one test: `tenant_id` being null
answers *whose* rows, never *what* the reader may see. It was verified to
fail — `InvoicePolicy::viewAny` was temporarily changed to
`$user->isPlatformLevel() || $user->hasPermission(...)`, the exact inversion
ADR-0006 forbids, and both refusal cases went red with the dispatcher
getting `200` on a client's invoice. This project has already shipped that
bug once in a different shape (a Dispatcher who could export a client's
revenue), which is why it has a test rather than a comment.

**All four rounding rules are priced end to end** in `RoundingModeTest`.
`TripPricingTest` had covered half-up and down; half-down and up — two of
the four a client's contract can be written on — had never run, so two arms
of `toBrick()` could have been mapped to the wrong Brick constant and
nothing would have said so.

The load-bearing case is the **exact tie**. On an ordinary fractional
amount three of the four rules agree, so only a true half separates half-up
from half-down. Verified the way the table above describes: mapping
`HALF_DOWN` to `HalfUp` turns the tie test red while the entire
pre-existing billing suite stays green — which is precisely why it was
worth adding rather than assuming the module was covered.

`RoundingMode::default()`'s fallback is covered too: a rate card version
with no stated rule, and a `money.default_rounding` naming something the
enum does not have, must yield half-up rather than throw. Billing every
tenant's trips failing over an env typo is a worse outcome than a silently
conventional default.

Fixtures live in `tests/Support/BillingFixtures.php` and obey two rules:
priced rate card versions come from `RateCardService`, and trips are walked
through `TripStateMachine` transition by transition. A `Trip` row inserted
directly at `trip_completed` would have an empty `trip_events` timeline —
which is where waiting-time billing comes from — and would test nothing.
Services called outside HTTP bind the tenant by hand; `TenantScope` fails
closed, so a forgotten binding does not error, it passes vacuously.
