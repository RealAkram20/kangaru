# ADR-0062: Head office reads the directory, not the operations

**Status:** Accepted — 23 August 2026

**Amends:** ADR-0055 §2. That decision's property was *"no account in the
system can read every fleet's data in one query, including Super Admin."* It
is narrowed here, deliberately and with the owner's eyes open, to: **no
account reads every fleet's operations. The directory is Kangaru's.**

**Amends:** ADR-0060 §5 and its Consequences, which read as though Kangaru
could not onboard a corporate client at all.

**Amends:** the `K4` decision recorded in `docs/platform-plan.md` §6 q4 — the
count-only answer — which this supersedes.

## Context

The owner, 23 August 2026:

> who creates the corporate clients — because we need the super admin and the
> fleet super admin to be able to add corporate clients when needed

Two things were wrong with the answer the codebase gave.

**The first is that today's answer is "a Super Admin, halfway".**
`companies.create` sits on the `super_admin` **role**, which both Kangaru's
Super Admin and a fleet's hold — so both could already create one. But
`CompanyService::create()` takes a `tenant_id` the caller must already have,
writes **no `operator_client` row**, and creates **no login for the client**.
The result is a company profile attached to a tenant, served by no fleet, that
nobody at the client can sign into. That is not an onboarding; it is a row.

**The second is that ADR-0060 read as if head office were excluded.** Its §5
says *"Not Kangaru"* and its Consequences say *"Kangaru does not approve client
onboarding."* Both sentences are about **approving a second fleet joining an
existing client**, and that reasoning stands — head office should not gate a
fleet's sales cycle. But they were written as though head office had no
onboarding role at all, and the owner needs one.

### The tension the ask exposes, stated plainly

`K4` gave Kangaru a client **count** and no list, on ADR-0055 §2's reasoning,
and `KangaruOverviewController` has a test that walks the whole payload
asserting every value is a scalar.

If head office can create a corporate client, head office cannot then be
unable to see the one it just created. "Did that onboarding work?" would be
unanswerable without acting as a fleet — which is absurd for an act head
office performed itself.

So the count-only line cannot survive the ask. The question is what replaces
it, and the answer is not "everything".

## Decision

### 1. The line moves from *how much* to *what kind*

ADR-0055 §2 drew its line at **volume**: no cross-fleet read at all. That is
replaced by a line drawn at **kind**:

| Kangaru reads | Kangaru does not read |
|---|---|
| The fleet companies | Their trips, bookings, dispatch |
| The corporate clients | Those clients' bookings and trips |
| The contracts between them, and their status | Invoices, rate cards, credit used |
| Who serves whom, and since when | Drivers, vehicles, inventory |
| Counts of any of the above | Any client's or driver's personal data |

**The directory is the network, and the network is Kangaru's business.** A
platform that manages fleet companies and charges them (ADR-0058) cannot be
unable to say which clients are on it — that is not operational data, it is
the shape of the thing Kangaru sells.

**The operations remain reachable only by acting as somebody** (ADR-0056),
which is announced, time-boxed and recorded against both names. That is the
half of ADR-0055 §2 that was load-bearing, and it is untouched.

### 2. Head office gets a client register, and it stops there

Names, trading names, status, registration number, and **which fleets serve
them**. Not their bookings, not their trips, not their invoices, not their
staff, not their credit limits — a credit limit lives on the contract and is a
commercial term between a fleet and its client.

This is a real widening and it is worth naming the cost: **a Kangaru Super
Admin can now enumerate every corporate client on the platform.** That was
previously impossible for anybody. The owner accepted it knowingly; it is
recorded here so nobody later reads it as drift.

The narrowing that keeps it honest: `CompanyResource` must **allow-list** what
this register serves rather than spreading the model. AGENTS.md's rule about
never spreading a whole object applies with full force, because the model
carries `credit_limit_minor` and `billing_email` that this reader may not have.

### 3. Both Super Admins onboard, and both must name a fleet

A fleet's Super Admin onboards a client, and their own fleet takes the
contract — it is the only fleet they could mean.

**Head office's Super Admin onboards a client and must choose the fleet from
a list.** Required, not optional. A client with no fleet has nobody to run its
trips, cannot book, and would need a second step nobody is prompted to take —
the same failure shape as a fleet with no account (ADR-0059 §5), which the
`K4` dashboard already counts precisely because that class of orphan is
invisible until somebody needs it.

So the invariant is: **every corporate client has at least one contract from
the moment it exists.** Client, contract and the client's first administrator
are created in one transaction, whoever performs it.

### 4. Nothing about path B changes

ADR-0060 §4 and §5 stand exactly as written. A fleet that finds a client
already on Kangaru may **only ask**; a `requested` contract grants **no read
whatsoever**; and **the client approves** — not Kangaru, and not the incumbent
fleet.

Head office creating a client is a different act from a fleet asking to join
one, and this ADR widens only the first. Head office is still not in the
approval path, for the reason ADR-0060's Consequences give: it would make
head office a bottleneck on every fleet's sales cycle.

### 5. The register is read-and-onboard, not read-and-operate

Head office may create a client, see the register, and see which fleets serve
whom. It may **not** book a trip for a client, issue an invoice to one, change
a credit limit, or edit a client's staff. Those are the fleet's, and head
office reaches them by acting as the fleet.

## Consequences

- **`K4`'s count-only answer is superseded.** `KangaruOverviewController`'s
  scalar-only test stays exactly as it is — the dashboard is still counts —
  but the client **register** becomes a real screen at Kangaru level.
- **`docs/platform-plan.md` §6 q4 is answered differently** from its own
  recommendation, and the plan is amended rather than left disagreeing.
- **Kangaru's menu grows by one**, from ten entries to eleven: Corporate
  clients, under The network beside Fleet companies.
- **`CompanyService::create()` is rewritten** by `K6`: registration number
  first, lookup, client + contract + first admin in one transaction, and the
  fleet named by the caller or implied by their level.
- **`CompanyPolicy` gains a level dimension.** `companies.view` on a fleet's
  role must still mean *their* clients; the same permission on a Kangaru
  account means the directory. A permission alone cannot express that, which
  is the same shape `canUseNavLevel` solved on the frontend.
- **The data inventory gains a row.** A cross-fleet client register is a new
  disclosure surface even though it carries no personal data, and
  `docs/data-inventory.md` is where that is recorded.

## Alternatives considered

**Keep count-only (ADR-0055 §2 unamended).** The strictest position and the
one I recommended. It fails the owner's actual requirement: head office would
create a client and be unable to confirm it worked.

**Give head office the same client register a fleet has, credit limits and
all.** Simpler to build, and it hands head office commercial terms agreed
between two other parties. A credit limit is a fleet's judgement about its own
customer's creditworthiness, and Kangaru has no part in it.

**Let head office create a client with no fleet, and assign one later.**
Offered and rejected: it produces a client that cannot book, and an orphan
class that is invisible until somebody needs it. The platform already has one
such class — a fleet with no account — and it needed a dashboard counter to
stay visible. One is enough.

**Let head office onboard only by acting as a fleet.** Tempting, because it
changes nothing: the fleet's own flow does the work and the audit trail is
perfect. Rejected because acting as is for *support* — reading somebody's
console to help them — and using it as the routine path for an act head office
performs in its own right would make the audit log's acting-as rows
meaningless by volume.
