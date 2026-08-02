# ADR-0006: Platform Staff and Cross-Tenant Operational Reads

**Status:** Proposed

**Amends:** ADR-0001 (Multi-Tenancy Model). Tenant scoping stands and the
scope still fails closed; this defines the one reviewed way past it.

**Resolves:** the item ADR-0005 moved out mid-pass — "relocating Shanitah's
staff" — which it deferred because making platform staff *work* needs a
decision this ADR is.

## Context

ADR-0005 established that Shanitah operates the fleet and the platform, and
that a corporate account is a client. It also established that Shanitah's
own staff — dispatchers, Finance, HR, Operations — are platform-level and
belong to no tenant. It could not act on that half, and said so:

> a user with no `tenant_id` gets `TenantScope`'s fail-closed default, so a
> platform dispatcher would see **no bookings and no trips at all**.

So dispatchers and Finance officers are still seeded *inside* client
tenants, as though Centenary Bank employed them. A dispatcher sitting in
the Bank's tenant now dispatches the platform's whole vehicle pool, which
was the more urgent half; but they still see only the Bank's bookings, and
a second client's work is invisible to them. At two tenants that is
survivable. It does not survive fifty, and it is not what the business is.

### The pattern already exists, five times

This is not a new capability. It is an existing one that was written
per-service, by hand, each time somebody hit the wall:

| Where | What it does |
|---|---|
| `CompanyService::list()` | `$user->tenant_id === null ? Company::allTenants()->get() : Company::all()` |
| `UserController::scopedQuery()` | omits the `where` when the actor has no tenant |
| `UserAdminService` | picks the new account's tenant from the actor's |
| `UserPolicy` (line 106) | platform actors administer everyone |
| `AuditLogController` | platform actors read every tenant's trail |

Five copies of one rule, in four modules, with no shared name. Bookings and
trips are not special — they are simply the tables nobody has written the
sixth and seventh copies for. Doing that by hand twice more is how a
sixth copy eventually gets the predicate backwards.

### What is actually blocked

- **Automatic dispatch** (Phase 1 by owner approval) cannot see a
  cross-client queue. A matcher that can only see one client's demand is
  not matching, and building it inside a tenant bakes the wrong shape in.
- **The audit log UI.** Role audit rows carry a null `tenant_id` — the role
  catalogue is platform-wide (ADR-0004) — so no tenant-scoped reader will
  ever show them. The platform's own trail needs a reader that is not
  tenant-bound.
- **Onboarding a Shanitah employee at all.** There is no correct answer
  today: put them in a client tenant and they see one client; give them no
  tenant and they see nothing.

## Decision

**Platform staff are users with `tenant_id` null. They read across tenants
only where an existing permission already says they may, and only through
one named, explicit scope.**

### 1. `TenantScope` does not change

It keeps failing closed. A missing `TenantContext` still yields no rows.

This is the load-bearing part of the decision. The tempting version —
"treat a null context as *see everything*" — inverts ADR-0001's safest
property. Today a job that forgets `app(TenantContext::class)->set($id)`
returns nothing and its test fails vacuously; under that change it would
return every tenant's rows and the test would pass. A vacuous pass is a
bug. A silent cross-tenant read is the breach ADR-0001 calls the single
worst thing this platform can do. **Rejected on that basis alone.**

### 2. One named scope replaces the five hand-rolled copies

A `forActor(User $actor)` query scope, alongside `allTenants()` on
`BelongsToTenant`:

- actor has a `tenant_id` → normal tenant scoping, unchanged;
- actor has none → the global scope is dropped for that query.

Every cross-tenant read goes through it. `allTenants()` remains, but for
what it was for: seeders, jobs and console commands that have no actor at
all. A raw `allTenants()` in a request path becomes a review failure,
because `forActor()` is now the thing that expresses the intent.

### 3. Authorization is the permission catalogue, unchanged

No new permission axis. ADR-0004's catalogue already answers *what* a user
may see; `tenant_id` being null answers *whose*. The two compose:

- a platform Dispatcher holds `bookings.view.all` and `trips.view.all` and
  therefore sees every client's bookings and trips;
- they do **not** hold `invoices.view`, so the same mechanism shows them no
  client's money;
- a platform Finance officer holds `invoices.view` and sees all of it.

The alternative — a `platform.*` mirror of the catalogue — doubles it and
puts the same question in two places. The rejected shape is a single
blanket `platform.crosstenant`, which would hand a dispatcher every
client's invoices the moment it was granted.

### 4. Writes bind the subject's tenant, never the actor's

This is the sharp edge and the reason this is an ADR rather than a patch.

`BelongsToTenant::creating` auto-fills `tenant_id` from `TenantContext`. A
platform dispatcher has none, so a row created while acting on Centenary
Bank's booking would get `tenant_id` null and hit a non-nullable foreign
key — or worse, on a nullable column, become a row belonging to nobody.

**A mutation by platform staff binds the tenant of the record being acted
on, for the duration of that mutation**, and restores it afterwards.
Assigning a driver to the Bank's booking runs with the Bank's tenant bound,
so the trip, its `trip_events` and its notifications all land in the right
place. The actor is platform-level; the *work* is always some client's.

### 5. Audit rows carry the subject's tenant

Following from 4: a platform dispatcher's action on the Bank's trip is
recorded against the Bank's tenant, so the Bank's own audit log shows it.
An action on nothing tenant-owned — editing a role — keeps a null
`tenant_id` and is visible only to the platform reader. A client must be
able to see who touched their data, including when it was us.

## Consequences

**Creating a platform account becomes a serious act.** A user with
`tenant_id` null and broad permissions can read every client's operations.
That is already true of Super Admin; this makes it true of a category
rather than one account, and `staff.manage` is the gate. Onboarding a
platform employee should be Super Admin's alone.

**The isolation suite gains an obligation, not a hole.** ADR-0001's
mandatory cross-tenant tests keep asserting that a *client* user sees only
their own. They must be joined by the mirror: that a **platform** user with
no permission on a surface sees nothing of it either — a platform
dispatcher must be proved unable to read invoices. Without that, this ADR
is a hole with a name.

**Five call sites collapse into one.** `CompanyService`, `UserController`,
`UserAdminService`, `UserPolicy` and `AuditLogController` all move onto
`forActor()`. Behaviour is unchanged by design; the point is that the sixth
place cannot be written differently.

**`TenantContext` gains a scoped-override.** Something of the shape
`$context->for($tenantId, fn () => ...)`, restoring the previous value
afterwards — including on exception, or a failed dispatch leaves the rest
of the request bound to a client the actor is not acting on. That is
concurrency-adjacent and needs a test that asserts restoration after a
throw.

**Seeded staff move, and the seed changes shape.** Dispatcher and Finance
accounts leave the client tenants they are currently seeded into. Any test
that reaches for "the Bank's dispatcher" changes with them.

**Reports and exports need a tenant decision.** A platform user running a
trip report has no tenant to scope it to. Either the report gains a tenant
filter or it spans all clients; a monthly invoice run must not silently
become cross-client. Named here because it is a consequence, not solved
here.

## Scope

**In:** the `forActor()` scope, the scoped `TenantContext` override, moving
the five existing bypasses onto it, opening bookings/trips/trip_events to
permitted platform readers, the mirror isolation tests, and the seeder
move.

**Out, deliberately:**

- **Automatic dispatch.** This unblocks it; it is not it.
- **The audit log UI.** This makes the platform-wide reader expressible.
  The screen is its own pass.
- **A tenant column or filter in the dispatch UI.** A cross-client queue
  that does not show which client each row belongs to is worse than no
  cross-client queue. Frontend work, and it should follow the backend.
- **Reports scoping**, per the consequence above.
- **Individual riders.** Still needs `tenant_id` to be genuinely optional on
  a booking, which this does not do — platform staff have no tenant; a
  walk-in's *booking* would have none, which is a different change.

## Alternatives considered

**Treat a null `TenantContext` as "all tenants".** One line, no new
concepts. Rejected in Decision 1: it converts every forgotten `set()` from
a visible nothing into a silent everything.

**A "Shanitah" tenant that staff belong to.** No schema change, no scope
change. Rejected for the same reason ADR-0005 rejected it for the fleet:
`TenantScope` would mean two different things depending on who is asking,
and the exception would be permanent and load-bearing. It also does not
work — a dispatcher in the Shanitah tenant sees Shanitah's bookings, of
which there are none.

**Per-request tenant switching** — a platform dispatcher picks a client and
works inside it, like an account switcher. Genuinely good for Finance and
support, and worth having later. Rejected as the primary mechanism because
dispatch is precisely the job that needs the *whole* queue at once; forcing
a choice of client first makes the cross-client view the one thing it
cannot express.

**A parallel `platform.*` permission catalogue.** Explicit about
cross-tenant reach at the point of grant. Rejected: it doubles a catalogue
that ADR-0004 deliberately keeps as one curated list, and every new
permission would need two cases and a rule about what happens when they
disagree.
