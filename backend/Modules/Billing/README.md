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
(`RateCardRate`). Prices never change; a card gains a new version and every
invoice keeps pointing at the version it was raised under.

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
- `App\Support\Money\{Shillings, MoneyMinorCast}`, `App\Concerns\{Auditable,
  BelongsToTenant}`, `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode`.
- `brick/money` (and `brick/math`), added by this module.

Nothing depends on Billing yet. `Modules/Reports` will, when a financial
report lands.

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
   less-payments.
2. **Monthly consolidated invoicing.** One invoice per trip. PROJECT.md wants
   monthly billing; that makes `invoices.trip_id` nullable with a line-level
   trip reference, which is additive per the zero-downtime rule.
3. **Zone pricing and the geofencing engine.** `invoice_lines.zone` exists
   and is always null, so invoices issued before zones arrive are
   unambiguously "no zone applied" rather than "we did not record it".
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
9. **A frontend.** There is no Billing page — rate cards are set up and
   invoices raised through the API. This is the natural next pass, and the
   biggest single gap in the module.
10. **MFA on the roles that can move money.** `InvoicePolicy` and
    `RateCardPolicy` already confine issuing, crediting and rate-setting to
    Super Admin and Finance — the two roles AGENTS.md requires MFA for. The
    authorization boundary is right; the second factor is a known
    platform-wide gap and will sit on top of it.
11. **Per-tenant billing timezones.** `config/billing.php` is global; every
    Phase 1 tenant operates in Uganda.
12. **Rate card archival.** `RateCardStatus::ARCHIVED` exists and is never
    set by any route — a card is created active and stays active.

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
| `WaitingTimeCalculator` truncating once, not per pause | "sums waiting seconds across pauses before truncating to minutes" |
| `CreditNoteService::assertWithinInvoice()` | all of `CreditNoteTest` |
| `InvoiceService` idempotency replay | "returns the original invoice on a replay of the same idempotency key" |
| `RateCardVersion` immutability | "refuses every attempt to edit a rate card version or its rates" |

`BillingCrossTenantIsolationTest` is the ADR-0001 mandatory isolation proof.
It exists separately from the other modules' because a leak here is another
client's *money* — their prices, their totals, their disputes — and because
both tenants' first invoice is numbered `...000001`, so a test asserting on
invoice numbers alone would pass straight through a leak. It asserts on
uuids and on row counts.

Fixtures live in `tests/Support/BillingFixtures.php` and obey two rules:
priced rate card versions come from `RateCardService`, and trips are walked
through `TripStateMachine` transition by transition. A `Trip` row inserted
directly at `trip_completed` would have an empty `trip_events` timeline —
which is where waiting-time billing comes from — and would test nothing.
Services called outside HTTP bind the tenant by hand; `TenantScope` fails
closed, so a forgotten binding does not error, it passes vacuously.
