# ADR-0029: Driver earnings and the wallet ledger

**Status:** Accepted (14 August 2026)

**Depends on:** ADR-0026 (the walk-in tariff — the only place a fare exists),
ADR-0014 (settings — where the commission rate lives), ADR-0022 (token
scope), ADR-0016 (the driver account these entries belong to).

**Scoped against:** ADR-0005 and ADR-0012 both defer "payments" to a future
decision. This ADR does **not** make that decision. It settles what a driver
has earned and what they owe; it does not take a payment from anybody, does
not integrate a gateway, and does not move money. Those remain deferred, and
§6 says what this deliberately leaves for them.

## Context

The Driver App's home screen has a wallet balance on it. Until now it
rendered an em dash, because nothing in the platform could produce the
figure — and a driver who reads a balance they cannot collect has been lied
to about money, which is the worst thing this app can do.

What exists already is narrower than it looks. `trips.fare_minor` records
what a **walk-in ride cost the passenger** (ADR-0026 §3), in cash, at the
tariff. That is a customer-side number. It is not the driver's earnings and
must never be shown as such: the driver holds that cash, and part of it is
the platform's.

So the gap is not a display problem. There is no record anywhere of what a
driver is owed, what they owe, or what has been settled between them and the
office.

## Decision

**An append-only ledger of minor-unit entries, one per event, with the
balance derived by summing it. The platform's cut is a percentage the Super
Admin sets.**

### 1. A ledger, not a balance column

`driver_ledger_entries`: `driver_id`, `trip_id` (nullable), `kind`,
`amount_minor` (signed), `currency`, `description`, `created_by_user_id`
(nullable), timestamps. Append-only: nothing is updated, nothing is deleted,
and a correction is a new entry that reverses an old one.

A `balance_minor` column on `drivers` was the obvious alternative and is
rejected for the reason every finance system rejects it: a single mutable
number cannot answer "why". A driver disputing their balance, or an
accountant reconciling a week, needs the entries; a column gives them a
figure and no recourse. Summing an indexed integer column per driver is
cheap, and this is the same instinct ADR-0026 already followed by recording
the fare on the trip rather than deriving it later.

Amounts are **signed minor units**, never floats. A credit is positive, a
debit negative, and the balance is `SUM(amount_minor)`. Money in this
codebase never passes through a binary fraction.

### 2. Four kinds, and what each one means

Signs are from the **driver's** point of view: positive means the platform
owes them, negative means they owe the platform.

| kind | sign | raised when |
|---|---|---|
| `fare_earned` | + | a trip with a fare completes: the driver's share |
| `cash_collected` | − | the same completion: the gross fare they took in hand |
| `settlement` | ± | money actually moved, in either direction |
| `adjustment` | ± | a correction, always with a reason and an author |

`fare_earned` and `cash_collected` are written **as a pair in one
transaction** at completion, from the same fare, and the pairing is what
makes the balance mean anything.

**This was got wrong on the first pass and the tests caught it.** The
original design paired `fare_earned` with a `commission` debit, which
double-counts: a driver's share is already net of commission, so crediting
8,000 and debiting 2,000 of a 10,000 fare left a balance of +6,000 — as if
the platform owed them money it had never received. For a cash fare the
passenger hands the driver the *whole* fare, so the honest entries are
+8,000 earned and −10,000 held, netting to −2,000: precisely the commission
they now owe. The commission is not lost — it is stated in the
`cash_collected` description and derivable as gross minus earned.

`settlement` replaced a one-directional `payout` for the same reason. Cash
work runs the other way: a boda rider remits money *to* the office far more
often than the office pays out. One signed kind cannot disagree with itself
the way a `payout`/`remittance` pair could.

### 3. The rate is a setting, not a constant

`billing.driver_commission_percent` joins the ADR-0014 catalogue: integer 0
to 100, default 20, `settings.manage` to change, audited like any other.

**The rate in force at completion is captured in the entry's description.**
Changing the setting must never restate what a driver already earned — a
retroactive commission change is the kind of silent rewrite an audit trail
cannot distinguish from theft. Past entries are immutable (§1); the new rate
applies to the next completion.

Rounding: the commission is `floor(fare × percent / 100)`, and the driver
takes the remainder. The house rounds against itself, by a shilling at most,
because the alternative is a driver being short-changed by rounding they
cannot see.

### 4. Only fares the platform actually priced

An entry pair is raised only where `fare_minor` is present — walk-in rides
(ADR-0026 §3). A corporate trip is invoiced to the client and carries no
per-trip fare; inventing one from a rate card would be fabricating a number,
which §1 of the screen rules forbids and which would double-bill a client
already invoiced.

This is a real limitation and it is stated rather than hidden: a driver
running only corporate work sees a zero balance, which is true — the
platform owes them nothing *through this ledger*, because their pay is a
payroll matter the platform does not model.

### 5. What the driver sees, and what it is called

`GET /me/stats` gains `wallet_balance_minor` and `earnings_today_minor`.

- **Wallet balance** is the whole ledger summed: what the office and the
  driver owe each other, net. Negative is not merely legitimate, it is the
  *normal* state for cash work — a boda rider taking fares all day is in
  debt to the platform for its share until they settle. The app must
  therefore render a negative balance plainly rather than clamping it.
- **Earnings today** is the sum of today's `fare_earned` entries: the
  driver's own share, not the gross fare. The home screen's "Fares today"
  tile becomes "Earnings today" and finally means what its label says.

### 6. What this does not do

No gateway, no mobile money, no automatic payout, no invoice to a driver.
`settlement` entries are written by the office when cash changes hands in
either direction, and the platform records that it happened rather than
making it happen. Collecting a customer's money electronically is still the deferred
payments decision, and this ADR does not pre-empt its choices.

There is also no per-driver payout schedule, no minimum balance, and no
notification. All three are policy, and none is needed to tell a driver what
they are owed.

## Consequences

A driver can see what they earned today and what stands between them and the
office, and both figures trace to entries somebody can read back to them.
The Super Admin sets the commission from Settings and changes it without a
deploy, and yesterday's earnings do not move when they do.

The office gains an obligation: `payout` entries have to be written when
cash changes hands, or every driver's balance drifts further from reality.
That is an operational commitment this ADR assumes and does not create — the
same shape as ADR-0027's applications queue.

`driver_ledger_entries` is a new table this ADR owns. `Modules/Billing`
keeps its meaning of "what a client owes"; this is the other direction and
deliberately does not live there.

## Alternatives considered

**A `balance_minor` column on `drivers`.** Rejected in §1: a number with no
history cannot be disputed or reconciled.

**Netting fare and commission into one entry.** Rejected in §2: it discards
the rate actually applied, which is the thing most likely to be questioned.

**Pairing `fare_earned` with a `commission` debit.** Tried, and wrong — §2
explains why. The arithmetic is the reason this ADR was amended before it
shipped rather than after.

**Deriving earnings on the fly from trips and the current rate.** Tempting —
no new table — and wrong for the reason §3 gives: the current rate is not
the rate that was in force, so every historical figure would silently change
the day somebody edited the setting.

**Storing money as decimals.** Refused on the same grounds as everywhere
else in this codebase.

**Waiting for the payments ADR.** Considered, and rejected as the thing that
keeps the screen lying. Knowing what a driver is owed is separable from
moving money to them, and §6 keeps the boundary explicit.
