# ADR-0042 — Where a driver's money is sent

**Status:** accepted, 2026-08-17
**Extends:** ADR-0029 (driver earnings and the wallet ledger), ADR-0032 (driver
settlement requests)
**Relates to:** ADR-0033 (driver documents), the Uganda Data Protection and
Privacy Act 2019 obligations tracked by work package W1-e

## Context

ADR-0032 gave a driver a way to *ask* to be paid: they raise a payout request,
the office confirms it, and the confirmation writes the ledger entry. What it
never recorded was **where the money should go**. The office asks the driver, or
already knows, or rings them — which works at one depot and stops working at
three.

The mockup for the driver's Profile screen carries a **Bank Details** row. An
earlier pass refused to build it, correctly at the time: ADR-0029 §6 rules out a
payout rail by name, nothing in the platform stored a bank account, and a row
opening a screen with no backend is a dead surface. The owner has since ruled
that it is built, and was explicit that it must be a real page rather than a
link to the Wallet.

## Decision

**A driver records one payout destination. The platform stores it and shows it
to the office. It does not move money.**

### 1. The boundary, restated because it is the whole design

ADR-0029 §6's sentence still holds: the platform *"records that it happened
rather than making it happen"*. This ADR does not overturn it and does not
build a rail.

- **No gateway, no automatic payout, no balance transfer.** Cash and bank
  transfers happen exactly as they do today. The office does the paying.
- **A destination is not an instruction.** Storing an account number changes
  nothing about when or whether somebody is paid; ADR-0032's request-and-confirm
  flow is still the only thing that moves a ledger.
- **Automatic disbursement stays an owner's decision**, because it needs a
  mobile-money or bank API — a paid, metered service, which the master plan §4
  rule 5 reserves to the owner. This ADR deliberately leaves the seam: a
  destination is exactly what such an integration would need, and nothing here
  pre-empts its choices.

### 2. One destination, with a kind

`bank` or `mobile_money`, one row per driver.

**Not two rows, one of each.** A second destination creates a question at the
moment of paying — *which one?* — and the person answering it is a clerk under
time pressure who does not know the driver's preference. One destination is
unambiguous, and a driver who wants to change it changes it. The screen is one
form with a type switch rather than two cards and a preference toggle, which is
also the fewest taps.

### 3. Encrypted at rest, at the application layer

`account_number` and `account_holder` are encrypted with Laravel's `encrypted`
cast — the treatment `users.mfa_secret` already gets, and the treatment
AGENTS.md asks for on driver identity documents.

This is not decoration. A bank account number plus an account holder's name is
the most directly exploitable data this platform stores about a driver: unlike a
trip history it has value to somebody who never touches the app.

**Consequence, accepted:** the column cannot be indexed or searched. Nothing
needs to — a destination is only ever read by `driver_id`.

### 4. Masked to the driver, whole to the office

- **`GET /me/payout-account` returns the last four characters only**, with the
  rest as a mask. A driver confirming "yes, that is my account" needs the tail;
  they do not need the platform to hand the whole number back to a handset that
  may be shared, stolen, or shoulder-read at a stage.
- **The office sees the whole number**, because a clerk cannot wire money to a
  mask. That read is gated on `drivers.manage` and lands in the audit log.

**A driver who mistypes cannot spot it from four characters, and that is the
cost.** It is accepted because the alternative — echoing a full account number
back to every handset on every profile load — is the larger risk, and the
mitigation is cheap: re-entering replaces it.

### 5. No verification workflow

The office does not approve a payout destination the way it verifies a licence
(ADR-0033). A wrong account number fails at the bank, visibly, and to the person
who typed it; a compliance queue for it would be process without a hazard.

**Recorded as the seam if this changes:** the natural place is the same
review pattern `DriverDocumentReviewController` already implements.

### 6. Data protection

This is personal financial data under the **Data Protection and Privacy Act,
2019**. It belongs in `docs/data-inventory.md` (W1-e) with:

- **What:** account holder name, account number or mobile-money number, bank
  or provider name, and the destination kind.
- **Why:** to pay a driver what the ledger says they are owed.
- **Retention:** it follows the driver's account. When an ex-employee's account
  is anonymised on the master plan's 90-day rule, this row is deleted outright
  rather than anonymised — a masked account number has no audit value, and an
  invoice never references one.

**This is the first row of genuinely financial third-party PII on the
platform**, and W1-e should be told rather than discovering it.

## Consequences

- A driver can be paid without the office ringing to ask where.
- One more surface the office must be able to read, which is part of the loop
  and not an extra: `master-plan.md` §2's gate is not met by a backend the
  office cannot see.
- The encryption is only as good as `APP_KEY` stability — **W1-b already owns
  that**, and its brief names rotating the key as the thing that ends the
  platform. This ADR adds a second body of data to that blast radius.
- Nothing here makes a payment. If that is ever wanted, this is the record it
  would read, and the decision to buy a rail is still unmade.
