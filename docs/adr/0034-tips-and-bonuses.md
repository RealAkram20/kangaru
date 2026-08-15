# ADR-0034 — Tips and driver bonuses

**Status:** Accepted
**Date:** 2026-08-15
**Supersedes:** ADR-0029 §6, in part — see *Relationship to ADR-0029* below.
**Related:** ADR-0029 (the driver ledger), ADR-0032 (settlement requests),
ADR-0024 §7 (what a driver may see about a passenger).

## Context

Three driver-app mockups in a row have asked for a **Tip** row and a **Weekly
Bonus** row, on the Ride Complete card, the Earnings breakdown and the Wallet
statement. Each was refused, correctly, and the refusals are on the record:
tips were *"not a column, not an `InvoiceLineType`, not a `LedgerEntryKind`,
not a key in `order_requests.details`"*, and bonuses had *"no bonus,
incentive, surge, streak or target anywhere in the backend"*.

Refusing a figure the platform cannot produce is the right default —
`docs/screen-rules.md` §1 exists for it. But the refusal answered *"can we draw
this?"* and not *"should the platform do this?"*. The owner has now answered
the second question: **yes, build both.**

## Relationship to ADR-0029

ADR-0029 §6 says, of the driver ledger: *"No gateway, no mobile money, no
automatic payout, no invoice to a driver."* That sentence is **not overturned
here and is not in tension with this ADR.**

What §6 is about is the platform *moving money*. Neither feature does:

- A **tip** is cash a passenger puts in a driver's hand. The platform never
  touches it; it records that it happened, exactly as ADR-0032 records a
  remittance that happened at a depot counter.
- A **bonus** is an amount the office comes to owe a driver. It is recorded as
  a credit and is settled through the same cash handover as everything else.

What *is* superseded is the narrower claim, made in ADR-0029's consequences and
repeated in four screens' docblocks, that **tips and bonuses do not exist on
this platform**. They do now.

## Decision

### 1. A tip is declared by the driver and confirmed by the office

The mechanism is ADR-0032's, unchanged: a driver raises a request, the office
answers, and **the confirmation is what writes the ledger entry**. A tip
declaration is a third `SettlementRequestKind`.

It is not a customer-facing feature. A tip button in a passenger's app would
need a payment path, and ADR-0029 §6 rules that out — so a tip added there
could only ever be an instruction to hand over cash, which is what already
happens without any software.

**A tip declaration names its trip.** That is the difference from the other two
kinds and the reason the *one open request per kind* rule (ADR-0032 §4) becomes
**one open declaration per trip** for tips: a driver who took three tips in a
day has three real things to declare, where two pending payout requests are
still one driver asking twice.

### 2. The platform takes its usual commission on a tip

`billing.driver_commission_percent`, the same rate a fare pays, recorded in the
entry's description at the moment it is written so a later rate change cannot
restate it (ADR-0029 §3).

**This is a policy decision and it was the owner's**, but it also decided the
data model, and that is worth recording because the alternative was a
materially different build:

| | Commissionable (chosen) | Driver keeps the whole tip |
|---|---|---|
| Effect on the wallet balance | the commission, owed | **none at all** |
| Where it lives | the ledger, as a pair | its own table |
| On the wallet statement? | yes, as the mockups draw | **no** — it would break the invariant that the list sums to the balance |

The ledger *is* the balance. A tip that creates no obligation in either
direction has no signed amount to carry, and a `+2,000` row that moved nothing
would have made the statement stop reconciling with the figure above it.

### 3. A tip is recorded as a pair, like a fare

```
Cash fare 10,000 + tip 2,000, commission 20%

  fare_earned          + 8,000     the driver's share of the fare
  cash_collected       − 10,000    gross fare in their hand
  tip_earned           + 1,600     their share of the tip
  tip_cash_collected   − 2,000     gross tip in their hand
  --------------------------------
  balance                − 2,400   commission owed on both
```

`tip_cash_collected` is a fourth kind rather than a second `cash_collected`
row because `driver_ledger_entries` carries a unique index on
`(trip_id, kind)` — the guard that stops a retried completion (ADR-0023's
outbox) paying a driver twice. Splitting the kind keeps the trip link, keeps
that index doing its job, and reads correctly on a statement.

### 4. A bonus is an automatic weekly trip target

A driver who completes **at least `billing.bonus_weekly_trip_target` trips in a
calendar week** is credited `billing.bonus_weekly_amount_minor`.

- **Both live in settings**, never in a constant and never in the app. A
  threshold shipped in a handset goes on asserting the old number after the
  office changes it — a defect this codebase has already recorded once.
- **`billing.bonus_enabled` defaults to `false`.** Not because the feature is
  risky, but because it creates a liability against every driver on the
  platform. A scheme that switches itself on at deploy is an unbudgeted bill,
  the same argument that defaults `maps.routing_enabled` off.
- **Awarded over a closed week only**, by a scheduled command, never mid-week.
  A partial week cannot be measured against a weekly target, and a driver shown
  a bonus that later un-awards itself has been lied to about money.
- **Weeks are the fleet's weeks.** Boundaries come from
  `settings.regional.timezone` through `DriverEarningsService::timezone()`,
  which is the one place that resolves it. `config/app.php` is UTC, and a
  Kampala week measured in UTC starts on Sunday at 03:00.

A bonus has **no counterpart entry**. Unlike a tip it is not cash in anybody's
hand: the office simply comes to owe it, so the balance moves by the full
amount and settles through the ordinary handover.

### 5. Idempotency is a database guarantee, not a convention

`driver_weekly_bonuses` carries a unique index on `(driver_id, week_start)`.
A cron that fires twice, a manual re-run, and a deploy that overlaps a
scheduled window must all be safe — and the `(trip_id, kind)` index is the
precedent for making that the database's job rather than a code path's.

### 6. A tip never names the passenger

The mockup says **"Tip from Sarah N."**. The row says **"Tip"**.

ADR-0024 §7 releases a passenger's contact details to a driver only while a
trip is live. A wallet statement is permanent and scrollable, and a list of
everyone who has ever tipped a driver, by name, is precisely the directory that
rule exists to prevent. The trip number is on the row; the person is not.

## Consequences

- Four screens' docblocks stating that tips do not exist become wrong and are
  corrected in the same change.
- `DriverEarningsService` widens from summing `fare_earned` to summing the
  three credit kinds. The Earnings screen's breakdown gains **Tips** and
  **Bonuses** rows — which are now real, where the mockup's `UGX 0` bonus row
  was the exact thing `docs/screen-rules.md` §1 forbade.
- The office gains a third thing to answer in the settlement-requests queue.
  ADR-0032 §5's note stands: confirming money arguably belongs with Finance
  rather than `drivers.manage`, and this adds weight to that seam.
- **Nothing verifies a tip.** The office is confirming a driver's word, exactly
  as it does for a remittance. That is the same trust model, and it is
  deliberate — the alternative needs a passenger-side receipt this platform has
  no channel for.
