# ADR-0032: Driver settlement requests

**Status:** Accepted — 15 August 2026
**Amends:** ADR-0029 §6 (Driver earnings and the wallet ledger)
**Depends on:** ADR-0029, ADR-0004 (permissions), ADR-0014 (settings)

## Context

ADR-0029 gave a driver a wallet balance and, since the statement screen
landed, the rows behind it. It also said, in §6:

> No gateway, no mobile money, no automatic payout, no invoice to a driver.
> `settlement` entries are written by the office when cash changes hands in
> either direction, and the platform records that it happened rather than
> making it happen.

Two things have happened since.

**First, the obligation §6 created was never met.** Its Consequences section
warned: *"The office gains an obligation: entries have to be written when cash
changes hands, or every driver's balance drifts further from reality."*
`DriverLedgerService::recordSettlement()` was written and has never had a
controller, a route or a console screen. So no settlement has ever been
recorded, every balance has only ever moved in one direction, and the figure a
driver now sees on their wallet screen gets further from the truth with every
cash fare.

**Second, drivers can now see that figure.** The wallet screen shows what they
owe and what they have earned. A driver who reads "You owe the office
UGX 47,000", walks to the depot and hands over 47,000 currently has no way to
make the app agree with reality, and no record that they tried.

The gap is not the payment. Cash at a depot is a solved problem and needs no
software. The gap is that **nothing records the intent, and nothing closes the
loop afterwards.**

## Decision

**A driver may raise a *settlement request*. The office confirms it, and the
confirmation is what writes the ledger entry.**

This is deliberately not a payments feature. Money still moves exactly as it
does today — cash, in person, at the depot. What changes is that both parties
now have a record of it.

### 1. Two kinds, mirroring the ledger's two directions

| kind | the driver is saying | ledger entry on confirmation |
|---|---|---|
| `remittance` | "I have handed you cash" | `settlement`, **positive** — reduces what they owe |
| `payout` | "Please pay me what I am owed" | `settlement`, **negative** — the office has paid them |

The mockup that prompted this called them *Deposit* and *Withdraw*. Those
names are wrong here and the app does not use them: a driver is not depositing
into an account the platform holds, and there is nothing to withdraw from. The
app says **"I've paid the office"** and **"Request a payout"**, which is what
is actually happening.

Note which is the common case. Cash work runs *towards* the office — ADR-0029
§2 made the same observation when it replaced a one-way `payout` kind with a
signed `settlement`. `remittance` is the button most drivers will press.

### 2. A request is not a balance, and never touches one

**A pending request changes nothing.** The wallet total keeps coming from
`SUM(driver_ledger_entries.amount_minor)` alone. Nothing about a request is
netted, reserved, or shown as "pending balance".

This is the whole safety property. If a request moved the balance, a driver
could request their way out of what they owe, and the office would be
reconciling against a number a driver controls. The balance stays a
consequence of what a human confirmed.

### 3. States, and what each means

`pending` → `confirmed` | `declined`. Nothing else, and no path back.

- **`confirmed`** writes the ledger entry, through
  `DriverLedgerService::recordSettlement()` and never by inserting a row, so
  the sign convention lives in one place. Confirmation is idempotent: the
  request carries the id of the entry it produced, and a replay returns the
  original rather than paying twice.
- **`declined`** carries a reason. "The office says no" with no reason is how
  a driver stops using a feature.
- **Append-only in spirit.** A confirmed request is never un-confirmed; a
  mistake is corrected the way ADR-0029 §1 corrects everything, with a new
  `adjustment` entry that reverses the old one.

### 4. One open request per kind

A driver may hold at most one `pending` request of each kind. Two pending
payout requests are not two payouts — they are one driver asking twice, and a
queue full of duplicates is a queue the office stops reading.

### 5. Who may confirm

`drivers.manage`, the permission that already governs a driver's record.

**This is a compromise and is recorded as one.** Confirming that money moved
is closer to a Finance act than a Fleet one, and AGENTS.md already requires
MFA for Finance because those roles "can move money and change rates". A
dedicated `drivers.settle` permission is the right refinement; it was not
added here because it touches the permission census and every role definition,
and this ADR's value does not depend on it. **When Finance separates from
Fleet, this is the seam to cut along.**

Every confirmation and decline is `Auditable` — who, what, when, from which
IP — because this is the first surface on the platform where a staff action
directly changes what a driver is owed.

### 6. What this still does not do

Unchanged from ADR-0029 §6, and worth restating because this ADR is easily
misread as reversing it:

- **No gateway, no mobile money, no card.** Nothing in this platform moves
  money electronically, and a request is not a transfer.
- **No automatic payout, no schedule, no minimum balance.** The office decides
  when it pays and when it collects, exactly as before.
- **No notification.** A driver sees their request's state when they open the
  wallet.

The sentence from §6 that mattered — *"the platform records that it happened
rather than making it happen"* — is not weakened by this. It is finally
implemented: before this ADR, the platform did not record it either.

## Consequences

**The obligation §6 named is now discharged on the driver's side and moved to
the office's.** There are endpoints to raise, list, confirm and decline a
request. **There is still no console screen** — the office can act only
through the API, and building that screen is the next step. That is a smaller
and more honest gap than the one it replaces: previously nothing could record
a settlement at all.

**A driver can now be told "no", which they could not before.** That is a new
kind of conversation for this platform and the reason `declined` carries a
reason.

**Balances will start moving in both directions**, which will surface any
existing drift. A fleet that has been running since ADR-0029 has balances that
only ever grew more negative; the first month of remittances will look like a
correction and is not one.

## Alternatives considered

**A payment gateway (MTN/Airtel money).** Rejected as this ADR's scope: it is
a metered third-party integration with float management, reconciliation and
its own failure modes, and `quality-control` makes a new recurring cost the
owner's decision rather than an agent's. It is also not needed — the money
already moves fine; it was the *record* that was missing. This ADR does not
foreclose it: a gateway would confirm a request automatically instead of a
human doing it, and the request model is unchanged.

**Letting the office write settlements with no request.** Simpler, and it was
the original ADR-0029 plan. Rejected because it never happened in ten months
of the ledger existing, and because it leaves the driver — the party who
actually knows they handed over cash — with no way to start the conversation
or to prove they did.

**Letting a driver write the `settlement` entry directly.** Rejected outright.
The balance would then be a number the person it bills controls, and the first
audit would find it.
