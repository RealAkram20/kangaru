# ADR-0059: Three consoles, one codebase

**Status:** Accepted — 22 August 2026

**Depends on:** ADR-0055 (`access_level`, and Kangaru reading across no fleet),
ADR-0056 (acting as someone else — the mechanism this decision leans on).

**Amends:** nothing in substance. It makes visible in the menu a rule ADR-0055
§2 already made true in the database, and which the console currently
contradicts.

## Context

ADR-0055 §2 settled that **no account in the system can read every fleet's data
in one query, including Super Admin**, and that Kangaru's staff reach a fleet's
data by acting as that fleet or not at all.

The console does not reflect that. It offers one menu of 21 entries to
everybody, filtered by role, and that menu is built around registers Kangaru is
no longer entitled to read: a cross-fleet **Vehicles** register, a cross-fleet
**Drivers** register, **Trips**, **Dispatch**, **Live map**. Under ADR-0055
those are a fleet's, and to a Kangaru account they will increasingly answer
either 403 or — worse — a correct-looking page scoped to nothing.

The owner put the shape of the fix plainly on 22 August 2026:

> we can have menus that are only helping Kangaru on there side for the rest
> like Vehicels or Dirvers we can use the Login as feature to access all what we
> want to know and mage from our Fleet companies

and, in the same conversation, the reason:

> Kangaru should not have inventory but fleet does and kangaru manage these
> Fleet companies

### The blocking fact

`UserResource` does not send `access_level`, and the frontend `User` type has
no field for it. **The console literally cannot tell a Kangaru account from a
fleet account.** Every menu rule below is unimplementable until that is fixed,
which is why it is package `K1` and why `K1` gates almost everything else.

## Decision

### 1. The menu branches on level first, then on role

`users.access_level` — `kangaru`, `fleet`, `client`, `applicant` — selects
**which menu exists**. Role then filters within it, exactly as it does today.

These are two different questions and the existing code answers only the
second. *"May a Dispatcher see the dispatch board?"* is a role question.
*"Does a dispatch board exist in this person's world at all?"* is a level
question. Answering the second with a role list means adding every new
Kangaru-only entry to a deny-list of six fleet roles and never forgetting one.

An `applicant` gets no console. Their reach is keyed off their own id and
`AccessContext` leaves them unbound (ADR-0055 §4); they have a screen, not a
menu.

### 2. Three menus, as three files

The single `SECTIONS` constant in `AppShell.tsx` becomes `lib/menu/kangaru.ts`,
`lib/menu/fleet.ts`, `lib/menu/client.ts`.

The reason is not tidiness. Several agents build in one tree, and a single
menu constant is a file every package must edit — the collisions are
guaranteed and they are on the file that decides what the product *is*. Three
files means three packages append to three different places.

### 3. Kangaru's menu holds only what Kangaru owns

**The test, and it is meant to be applied literally: nothing Kangaru owns
moves, carries a passenger, or burns fuel.**

Kangaru's fourteen: Dashboard, Fleet companies, Plans, Walk-in orders, Walk-in
clients, Driver contracts, Public tariff, Commission, Reports, Audit log,
Kangaru staff, Roles, Settings, Notifications.

Twelve entries leave it: Bookings, Dispatch, Trips, Live map, Routes,
Companies, Vehicles, Drivers, Applications, Driver reports, Invoices, Rate
cards.

**They are not hidden. They do not exist at this level.** A hidden entry is a
403 waiting behind a door somebody will eventually find; a level that has no
such page has nothing to find. This is the same stance ADR-0055 §2 took against
a null context meaning "see everything" — the absence is declared, not
inherited.

### 4. What Kangaru gives up in reads, it keeps in reach

Support does not lose access to a fleet's data. It loses the *silent, permanent,
unlimited* form of it and gets the *announced, time-boxed, recorded* form built
by `S1`.

| | A cross-fleet register | Acting as (ADR-0056) |
|---|---|---|
| Who knows the read happened | nobody; it is a query | the subject sees a banner |
| How long it lasts | as long as the account | a session that expires |
| What the log holds | nothing | the row, with `impersonator_id` |
| What support sees | a row without context | the fleet's own console, as the fleet sees it |

The last row is the practical argument, and it is why this is an improvement
rather than a sacrifice. *"Why did this driver's job fail?"* is not answerable
from a driver row. It is answerable from that fleet's dispatch board at the
moment it happened, which is what acting as puts in front of you.

### 5. A fleet must always have at least one account to act as

ADR-0056 assumes **a person's identity**, not an organisation's. There is no
"act as Shanitah"; there is "act as Shanitah's fleet owner".

Therefore: **a fleet's first owner account is created in the same transaction
as the fleet, and a fleet's account count may never reach zero.** Deactivating
the last active account of a fleet is refused.

Without this, a fleet whose last administrator leaves becomes permanently
unreachable to the people whose job is to support it — and it fails at the
worst moment, because "the last person left" and "we need support" are
correlated events.

### 6. The fleet console is not a second console

What a fleet sees is what Kangaru sees while acting as somebody there — the
same routes, the same components, the same scope, under the banner. There is no
separate build, no parallel set of screens, nothing to keep in step.

This is the property that makes three menus cheap. Three *products* would not
be.

### 7. Aggregate counts are Kangaru's; rows are not

Kangaru's dashboard shows how many corporate clients are on the platform. It
does not list them, search them, or open one.

A count is a business metric and, once plans are priced by size (ADR-0058), a
billing input. A list of rows is a cross-fleet read of client data, which §2 of
ADR-0055 forbids. **The distinction is one endpoint, and it is very easy to
build the wrong one by accident** — which is the entire reason it is written
down here rather than left to the judgement of whoever builds the dashboard.

To look at a client, act as a fleet that serves them.

## Consequences

- **`K1` ships the mechanism with all three menus identical**, so it is a
  provable no-op for every existing account. `K4` makes them differ. A change
  to the file every other package touches should not also change what anybody
  sees.
- **`K4` must not run before `K3`.** Removing the twelve entries before the
  Log in as button exists locks support out of production. The order is not a
  preference.
- **Menu visibility is still not authorization.** `lib/navigation.ts` already
  says so and it remains true: every endpoint answers 403 on its own. This ADR
  changes what a menu offers, never what a server permits.
- **`RequireNavAccess` gains a level dimension**, or is superseded by one. The
  existing carve-outs stay — Roles, Settings and the applications queue are
  deliberately not behind it, because a custom role holding a permission is
  invisible to a slug list, and that argument is unaffected by levels.
- **Anything reached only from a removed entry needs a new home.** Vehicle
  categories, currently a panel inside the Vehicles page, is the known case.

## Alternatives considered

**Keep one menu; filter by role.** What ships today. It requires every
Kangaru-only entry to be denied to six fleet roles individually, forever, and
one forgotten entry is a fleet reading Kangaru's plans. Fails toward exposure.

**Two separate frontend apps.** Genuinely cleaner boundaries and roughly double
the work, permanently — two builds, two deploys, two component libraries
drifting apart. Rejected on §6: the fleet console has to be identical to what
support sees while acting as, and the cheapest way to guarantee identical is
for it to be the same code.

**Give Kangaru read-only cross-fleet registers.** The obvious compromise, and
it is precisely what ADR-0055 §2 rejected one level down. Read-only does not
address the objection: the problem with a cross-fleet read is not that it
writes, it is that it is silent and unbounded.

**Derive the level from `tenant_id` and `operator_id` being null.** Rejected by
ADR-0055 §4 already, for a reason that applies unchanged here — inference
promoted six accounts to head office silently, with nothing failing.
