# ADR-0067: The main fleet needs no contract

**Status:** Accepted (29 August 2026)

**Amends:** ADR-0009 §1 (vehicle allocation and dispatch). The 1000-point
contract bonus and its ordering are untouched; what changes is *eligibility*,
which was a separate question the earlier ADR did not have to ask because
there was only one fleet.

**Builds on:** ADR-0055 (fleet operators, above the client).

## Context

The owner, 29 August 2026, on finding that a boda rider on Shanitah's own books
could not take a Centenary Bank booking:

> *"i thought this driver is managed by shanitah in so they can access both
> walking and coporate clients — because shanitah is the main fleet that has
> got all the access to both walking and Coporate, the other just need to
> request another contract."*

Automatic dispatch commits a **contracted** vehicle or nothing (ADR-0009 §1,
reaffirmed by the owner on 28 August). That rule protects a client who has paid
to have vehicles set aside from being passed over for somebody else's van that
happened to be nearer, and it is right for the fleets ADR-0055 introduced —
companies that joined Kangaru to serve a particular client.

It was never a description of the house.

### Why the rule read wrongly for Shanitah

Before ADR-0055, Shanitah *was* the platform. ADR-0055 §3 puts it plainly:
*"There is no Shanitah row anywhere. Shanitah is the absence of a row."*
Giving the house an identity made it, for the first time, a fleet that could be
asked whether it had a contract — and the answer was no, because there had
never been anybody for it to contract *with*. A contract between the house and
a client it already serves is paperwork with nothing on either side of it.

The practical cost was visible the day before this decision. Making one boda
dispatchable took three hand-written allocations, and every new client would
have taken another. Meanwhile the refusal a desk saw — *"no vehicle and driver
are both free with enough seats"* — described a shortage that did not exist,
and the owner read it, reasonably, as a permissions problem.

## Decision

**1. A fleet may be marked as the main fleet, and its vehicles are offerable to
any corporate client without an allocation.**

`operators.is_main_fleet`, set on row 1 by migration. Not a constant and not
`id === 1`: being the house is a property of a fleet, and a white-label
deployment or a reorganised Shanitah would make the id wrong while the concept
stayed right. More than one row may carry it — two house fleets is a coherent
arrangement, and a unique constraint would only make it unrepresentable.

Not mass-assignable. Every other invariant on `Operator` guards against a
second row; this one guards against a fleet granting itself the house's
standing through whatever endpoint eventually creates fleets.

**2. Every other fleet still contracts for the work.**

Unchanged, and it is the half worth protecting. A fleet that is free, near and
capable has no standing to take another client's work without an agreement.

**3. Eligibility widened; the ranking did not move.**

`DispatchSuggestion::$mainFleet` is read beside `$contracted` by the offer path
and nowhere in the score. A contracted vehicle still outranks a house one by
the full 1000 points, so a paying client is still served from its own vehicles
first. What changes is what happens when they are all out: the job goes to the
house instead of back to a desk that would have picked the same vehicle by
hand.

**4. The refusal says which refusal it is.**

`NO_DISPATCH_CANDIDATE` covered three conditions with three different fixes —
wait, write a contract, or book a bigger vehicle — in one sentence naming none
of them. It now distinguishes "nothing is free" from "vehicles are free and
none is contracted to this client", and puts the fix in the sentence.

## Consequences

- **Walk-in dispatch is untouched.** It runs through `WalkInRecommender` and
  `DispatchOfferService`, which know nothing of allocations and were not
  changed. Only `DispatchRecommender` — the corporate board and auto-assign —
  is affected.
- **A test that asserted the old rule from Shanitah's own actor can no longer
  be written.** `BelongsToOperator::scopeForActor` means a fleet dispatcher
  never sees a rival fleet's vehicles, so "free, capable and refused" has to be
  asserted from the rival's own actor. It lives in `MainFleetDispatchTest`.
- **Existing allocations keep working and keep meaning something.** They still
  rank first. The three written for the boda on 28 August are kept by the
  owner's decision as real commercial arrangements rather than scaffolding.
- **Open:** nothing in the console shows or sets the flag. It is set by
  migration and changed by somebody looking at the database on purpose, which
  is right while there is one house and will not be when a deployment has to
  choose its own.
