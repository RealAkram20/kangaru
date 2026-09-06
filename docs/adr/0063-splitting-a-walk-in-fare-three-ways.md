# ADR-0063: Splitting a walk-in fare three ways

**Status:** Accepted — 23 August 2026

**Closes:** `docs/platform-plan.md` §6 questions 2 and 3, and with them the
last thing blocking `K8`'s commission half. `docs/fleet-model-plan.md` §5's
three open questions are now all answered.

**Depends on:** ADR-0055 §5 and §7 (walk-ins are Kangaru's, priced by the
public tariff, and a driver contracts with Kangaru directly), ADR-0029 (the
driver's wallet ledger), ADR-0058 §5 (subscription and commission are separate
debts).

## Context

`K8` built the contract: a driver asks, their fleet consents, Kangaru
approves. What it could not build was the money, because two questions were
open and both were the owner's. They were answered on 23 August:

> **1. the Fleet wins**
> **2. yes**

Question 1 was *who wins when a fleet's own booking and a walk-in want the same
on-duty driver.* Question 2 was *does the fleet get a share of a walk-in run on
its vehicle.*

### What those two answers do together

Separately they are scheduling and pricing. Together they settle something
larger: **a fleet is not a bystander to its driver's walk-in work.** It gets
first call on the driver's time and a share of what the driver earns on its
vehicle. Kangaru rents demand to a fleet's spare capacity rather than
competing with the fleet for its own drivers.

That framing matters because it decides the failure mode to design against. It
is not *"the fleet loses a driver to Kangaru"* — it is *"the fleet's own work
must never be displaced, and its asset must never be used for free."*

## Decision

### 1. The fleet's own work wins, and it wins by not being asked

When a fleet's booking and a walk-in both want the same on-duty driver, **the
fleet's work takes the driver.**

Implemented as an **exclusion at candidate selection**, not as a comparison at
assignment: a driver already assigned to, or offered, a fleet booking is not in
the walk-in pool at all. The alternative — offering both and letting the later
one win — produces a driver who accepts a walk-in and then has it taken away,
which is worse than never seeing it.

**No pre-emption, ever.** A walk-in already accepted is not cancelled because a
fleet booking arrived afterwards. The fleet wins the *allocation*, not the
right to interrupt work in progress: a passenger already waiting for a car is
not a queueing problem.

**Not built: the per-contract override.** The recommendation offered
*"overridable per contract"*, and the owner answered the plain question. A
fleet that wants Kangaru's work prioritised over its own is not a case anybody
has asked for, and the column can arrive with the fleet that asks.

### 2. The fleet takes a share, and only where its asset was used

A walk-in fare is split three ways:

| Party | Takes |
|---|---|
| The driver | the remainder — and they collected the cash |
| Kangaru | commission, for the demand |
| The fleet | a share, **for the vehicle** |

**The fleet's share is for the vehicle, not for the driver.** That is the whole
of question 2's wording — *"a share of a walk-in run **on its vehicle**"* — and
it decides the one case that would otherwise be arbitrary: a **driver-partner
who owns their vehicle has no fleet share**, because there is no fleet asset
involved and no fleet to pay. `drivers.owns_vehicle` already says this
(ADR-0048 §7), and it is the same flag that waives fleet consent in ADR-0055
§5. One fact, one column, two consequences.

Read `owns_vehicle` **from the trip's own record of whose vehicle it was**, not
from the driver's row today. A driver who buys their own car next year must not
retroactively unpay their old fleet.

### 3. Both rates live on the contract, in basis points

`driver_walk_in_contracts` gains `kangaru_commission_bp` and
`fleet_share_bp`, matching `night_multiplier_bp`'s convention.

**On the contract and not on the plan**, because they are terms between
Kangaru, a driver and that driver's fleet — a three-party agreement — and a
fleet's subscription plan (ADR-0058) is a two-party one. Putting a commission
rate on a plan would mean changing a tier silently repriced every driver's
existing agreement.

Both default from configuration rather than being nullable. A null rate is a
fare somebody has to interpret, and every interpretation of "no rate" is a
guess about money.

### 4. The split is computed once, at settlement, from the trip

Three ledger entries against one trip, and **they must sum to the fare**. The
driver's wallet already carries `FARE_EARNED` and `CASH_COLLECTED`
(ADR-0029); commission and the fleet share are two more debits against the
same trip.

**Reproducible from the trip and the contract, per ADR-0058 §5.** Anybody
disputing a figure must be able to recompute it from the trip record and the
rates in force, without reading a balance. Rounding is settled the same way
the rate card settles it — the remainder goes to the driver, because the
driver is the party who cannot re-invoice a rounding error.

### 5. A walk-in is a walk-in because a column says so

ADR-0055 §2 already required this and it is built here: **an explicit `channel`
column on bookings and trips.**

The inference — *"walk-in means `tenant_id IS NULL`"* — is true today and would
stop being true the first time a client-less booking exists for some other
reason. It would stop being true **silently**, in the predicate that decides
what head office reads and now also which fares get split three ways. A
mis-channelled trip is not a display bug; it is money going to the wrong
parties.

## Consequences

- **`K8`'s commission half is unblocked**, and `fleet-model-plan.md` §5 has no
  open questions left.
- **The walk-in dispatch pool excludes drivers on fleet work.** That is a
  change to candidate selection, which is the one place in this system where a
  mistake is invisible — a driver silently absent from a pool looks exactly
  like a quiet night.
- **`channel` is backfilled** from the inference it replaces, once, with the
  reasoning recorded — that is the last moment the inference is known to be
  true.
- **A fleet can now be owed money by Kangaru**, which it could not before. It
  needs somewhere to read that, and `K7`'s deliberately-empty *Kangaru bill*
  surface is where it goes.
- **Three parties on one fare means three ways to get the sum wrong.** The test
  that matters is not that each figure is right — it is that they add up to the
  fare, on every rounding boundary.

## Alternatives considered

**Let the walk-in and the fleet booking compete, newest wins.** Simplest
dispatch change and it produces the worst driver experience: an accepted job
taken away. Rejected in §1.

**Pre-empt an accepted walk-in when a fleet booking arrives.** A stronger
reading of *"the fleet wins"*, and it strands a passenger already waiting.
The fleet wins the allocation, not the right to interrupt.

**Pay the fleet share from Kangaru's commission rather than from the fare.**
Tidier for the driver, whose take would not depend on whose vehicle it is. It
makes the fleet's share invisible on the trip and turns a three-party split
into a private arrangement the driver cannot audit — and the driver is the
party who collected the cash.

**A flat share for every fleet.** One number to reason about, and it prices a
boda the same as a seven-seater. The rate is on the contract precisely so it
can differ.
