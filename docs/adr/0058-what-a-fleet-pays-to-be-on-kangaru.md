# ADR-0058: What a fleet pays to be on Kangaru

**Status:** Accepted — 22 August 2026

**Reverses:** `docs/fleet-model-plan.md` §6, which listed *"Kangaru billing a
fleet — a subscription or platform fee"* under **Explicitly not in this plan**,
with the reason: *"Walk-in commission is decided; what a fleet pays to be on
Kangaru is a commercial question, and the code should not guess at it."*

That sentence was right when it was written and is struck here rather than
edited there, so the reversal stays legible. **What changed is not the
reasoning — it is that the question has been answered.** The code is no longer
guessing; it is implementing.

**Depends on:** ADR-0055 (fleet companies exist and Shanitah is one of them).

**Companion to:** ADR-0059 (three consoles), ADR-0060 (one client, many
fleets).

## Context

ADR-0055 made Kangaru a platform with fleet companies on it. It settled how
Kangaru earns from **walk-in work** — a commission on a fare a contracted
driver collects — and deliberately left open what a fleet pays for **being on
the platform at all**.

The owner settled it on 22 August 2026:

> so we charge these Fleet companies, some thing at the end of the day for the
> start we can have it free on default but we can have other plans that they
> pay monthly or annually

Three things are decided in that sentence and each one has a consequence in the
schema:

1. There is a platform fee, distinct from commission.
2. **Free is the default**, not a trial and not an absence of a plan.
3. Plans vary by period — monthly, annually — so a plan is a thing with terms,
   not a boolean on the fleet.

### Why this cannot wait until there is a second fleet

The temptation is to defer it: there is one fleet, it is Shanitah, and Shanitah
is not going to be invoiced. But the fleet-creation endpoint is package `K2`,
and **every fleet created before plans exist is a fleet with no plan**. A
nullable plan that means "free" is exactly the inference ADR-0055 §4 refused
for access levels — *the level is declared, never inferred* — and it fails the
same way: silently, in the direction of giving something away.

So the decision is taken now even though the first invoice is far off, because
the column has to exist before the rows do.

## Decision

### 1. Free is a real plan, and it is the default

`plans` is a table. **Free is a row in it**, with limits, and a fleet points at
it by `plan_id`. There is no null plan and no "unlimited because unset".

A fleet created with no plan named gets the plan flagged `is_default`. If no
plan is flagged default, **fleet creation fails** — it does not fall back to
free, and it does not fall back to unlimited. An unpriced fleet is a
configuration error, and it should say so at the point of creation rather than
be discovered at the first billing run.

### 2. A plan is rows, not code

Limits, price, period and entitlements live on the row. Adding a tier, changing
a limit, or grandfathering an operator is a data change, not a deploy.

This is not a preference for configuration over code in general — this codebase
has the opposite instinct in most places, and `AccessLevel` is deliberately an
enum for exactly the reason this is deliberately not one. The distinction:
**an access level is a security boundary and must be reviewable in a diff; a
price is a commercial term and will change without an engineer.**

### 3. Shanitah is grandfathered by a named plan, never by being row 1

`operators.id = 1` is Shanitah (ADR-0055 §1). It would be easy, and wrong, to
write `if ($operator->id === 1)` anywhere in the billing path.

Shanitah gets a plan row of its own — *Founding fleet* — carrying its terms
explicitly: no limits, site-wide walk-in access, whatever commission was
agreed. The privilege is legible in the data, transfers if the row changes, and
does not turn into a magic number that outlives the reason for it.

### 4. A limit blocks adding. It never removes, disables or breaks what exists

This is the rule that decides how the whole feature feels, and it is stated as
a prohibition because the failure is easy to write by accident.

A fleet on Free (ten drivers) that somehow holds eleven — through a plan
downgrade, an imported roster, a limit that was lowered — **keeps all eleven
working**. Their drivers accept jobs, their trips complete, their wallets
settle.

What the limit does is refuse the **twelfth**, at the moment somebody tries to
add them, with a message naming the number and the plan.

Concretely, three prohibitions:

- **No retroactive deactivation.** Exceeding a limit never sets a status.
- **No silent enforcement deep in the stack.** The refusal happens in the
  create path, not inside dispatch. A driver who cannot get a job because of
  their employer's billing is a support call that takes an hour to diagnose.
- **A downgrade below current usage is refused**, and the refusal names the
  figures: *"Growth allows 10 drivers; this fleet has 38."* The office reduces
  first, then downgrades. The system does not choose which twenty-eight drivers
  to cut.

### 5. Subscription and commission are two different debts, in two different tables

They look similar — both are money a fleet's activity owes Kangaru — and
merging them makes both unauditable.

| | Commission | Subscription |
|---|---|---|
| Owed by | the driver's wallet (ADR-0029) | the fleet |
| Cadence | per trip | per period |
| In a month with no trips | nothing is owed | **the fee is still owed** |
| Reproducible from | the trip and the contract rate | the plan row and the period |
| Disputed by | showing the trip | showing the plan |

The last row is the argument. When a fleet disputes a figure, the answer has to
be reconstructible from one source. A single ledger holding both produces a
balance that neither the trip record nor the plan can explain on its own.

### 6. Kangaru's invoice to a fleet is not a fleet's invoice to its client

`invoices` today means a fleet billing its corporate client, on that fleet's
own number series (`document_number_sequences`, which ADR-0055 already scoped
per fleet). Kangaru billing a fleet is a different document, from a different
issuer, on a different series, and it does not appear in the fleet's own
invoice register alongside the ones it issued.

It gets its own table. Reusing `invoices` would put Kangaru's charge in the
list a fleet's finance clerk reads as *"money owed to us"*.

## Consequences

- **Package `K7`** builds this: the catalogue, the fleet's current plan, limit
  enforcement in create paths, and Kangaru's invoice to a fleet.
- **Package `K2` must not ship a fleet without a plan.** Fleet creation and
  plan assignment land in the same transaction, or `K2` ships with the default
  plan seeded and `K7` inherits fleets that already point at it. Either order
  is fine; a window where fleets exist with `plan_id` null is not.
- **Every create path gains a limit check** — drivers, vehicles, staff. That is
  a cross-cutting change, and it is the reason §4 is written as three
  prohibitions rather than one sentence: each of the three is a mistake
  somebody will otherwise make in one of those paths.
- **What a fleet pays is now visible to the fleet.** Its console gets a
  *Kangaru bill* entry (ADR-0059). A charge a fleet cannot see itself accruing
  is a dispute waiting to happen.
- **Nothing bills anybody yet.** Free is the only plan that has to work on day
  one. The billing run can be proved against a plan that charges nothing before
  it charges anyone, which is the safest possible first customer.

## Alternatives considered

**A boolean `is_paying` on the operator.** Cheapest, and it collapses the
moment there are two paid tiers — which the owner's sentence already implies by
naming both monthly and annual.

**Defer until a second fleet exists.** Rejected in Context: the fleet-creation
endpoint ships first, and fleets created without a plan are the problem this
ADR exists to prevent.

**Charge per driver or per trip instead of per period.** A usage price is
closer to value and much harder to predict — for the fleet, whose costs would
move with a good month, and for Kangaru, whose revenue would collapse in a bad
one. The owner asked for monthly and annual. A usage component can be added to
a plan row later without changing this decision.

**One ledger for commission and subscription.** Rejected in §5. The saving is
one table; the cost is that no disputed figure can be reconstructed from a
single source.
