# ADR-0043 — Closing a driver's account

**Status:** accepted, 2026-08-17
**Extends:** ADR-0016 (driver sign-in accounts), ADR-0032 (settlement requests —
the request/confirm shape this reuses)
**Constrained by:** `PRODUCT.md` and `master-plan.md` §6 (audit-grade
correctness), the Uganda Data Protection and Privacy Act 2019 (W1-e)

## Context

The driver Profile mockup carries a danger zone with **Delete**. Nothing in the
platform implements one: there is no self-service closure of any kind, and the
only related endpoint is `DELETE drivers/{driver}/account`, which is the
*office* detaching a login under ADR-0016 — a different act by a different
actor.

The owner asked for it and chose the full loop with an ADR rather than a button
that only appears to work.

## The constraint that shapes everything

**A hard delete is not available to this platform at any price.**

`PRODUCT.md` and `master-plan.md` §6 stake the product on audit-grade
correctness: every invoice reproducible from stored data, an append-only trip
timeline, an append-only driver ledger. A driver with completed trips, ledger
entries and invoices behind them cannot be erased without breaking the one
property the anchor client is buying — and deleting them would silently rewrite
finished invoices' subjects.

This is not a limitation to work around. It is the product.

## Decision

**"Delete my account" means *close it and anonymise on the retention schedule*,
requested by the driver and confirmed by the office.**

### 1. A request, not an action

Reusing ADR-0032's shape exactly: the driver asks, a human at the office
confirms or declines, and the confirmation is what changes anything.

**Why not immediate self-service.** A driver may be owed money, holding the
office's cash, or mid-shift with a passenger in the car. Every one of those is a
reason a person should look before an account stops working, and none of them is
knowable from the button. The office declining with a reason — *"settle your
balance first"* — is a better answer than a silent refusal or an account that
closes and strands a fare.

**One open request per driver**, for the reason ADR-0032 gives: two pending
requests are not two closures, they are one driver asking twice, and a queue
full of duplicates is a queue the office stops reading.

**A driver may withdraw their own pending request.** ADR-0032 deliberately left
this out and recorded that its absence was more annoying than it looked. It is
cheap, and changing your mind about closing your account is not an unusual
thing to do.

### 2. What confirmation actually does

1. Marks the request confirmed, with who and when.
2. Sets the driver `inactive`, so dispatch stops offering them work.
3. **Detaches the sign-in account** through `DriverAccountService`, the one
   service ADR-0016 allows to do it — never by deleting a `User` row directly.
4. Stamps `closed_at`, which is what the retention sweep keys off.

**What it does not do:** touch a trip, a ledger entry, an invoice, or an audit
row. All of them survive, and the driver's history stays reproducible.

### 3. Anonymisation is retention work, and is W1-e's

The master plan's retention rule already says ex-employee accounts are
anonymised after **90 days**. `closed_at` is the clock that rule runs on.

**This ADR does not build the sweep**, and says so rather than implying the data
is gone the moment the account closes. What it builds is the event the sweep
needs and the timestamp it measures from. Building the sweep without the
retention policy W1-e is writing would be inventing a rule; building the
closure without the timestamp would leave the sweep nothing to key on.

**The gap is real and is recorded**: between confirmation and the sweep, a
closed driver's name and phone number are still on their record. That is
correct — the office may need to reach them about a final settlement — but it
is a gap somebody must close, not one to assume closed.

### 4. The return path, by email, and why it is not in-app

**A closed account cannot sign in, so it cannot read an in-app notification.**
This is the same shape as the rejected applicant the completeness census found:
the actor loses the only surface that could tell them.

So `driver.closure.answered` is a **mail** notification. It is the second type
this platform has ever added for a driver-facing decision, and it earns the
addition on `NotificationType`'s own test — *"a type not on AGENTS.md's list
needs an argument, not just a use case"*. The argument is that the recipient has
no other surface, which is not true of any other gap in the census.

A decline carries its reason. A decline without one is how a driver stops using
a feature — ADR-0032 made the same call.

### 5. What is deliberately not built

- **No cooling-off period.** A confirmation is a human decision already; a
  timer on top would delay a closure the office has just agreed to.
- **No cascade to the payout destination.** ADR-0042 §6 has it deleted by the
  retention sweep, not by closure — the office may still owe a final payment,
  and deleting the destination at closure would mean not knowing where to send
  it.
- **No re-opening.** A driver who returns is a new application (ADR-0027),
  which is also the honest answer: their licence and documents need checking
  again.

## Consequences

- A driver can ask, and finds out what happened, by email.
- The office gains a queue it must actually watch. **It ships with a console**,
  because the completeness census found four features whose backend nobody in
  the office could reach and this is not going to be the fifth.
- Invoices, trips and the ledger are untouched by design, so the audit story is
  unchanged.
- **A gap remains, named in §3**: anonymisation is not implemented, only
  scheduled-for. W1-e owns the policy; whoever implements the sweep reads
  `closed_at`.
