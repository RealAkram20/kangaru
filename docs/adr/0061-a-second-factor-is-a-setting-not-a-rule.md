# ADR-0061: A second factor is a setting, not a rule

**Status:** Accepted — 23 August 2026

**Amends:** `AGENTS.md` Security — *"MFA is required for Super Admin and
Finance roles in Phase 1 — these roles can move money and change rates."*
That sentence becomes a **default**, not a constant.

**Amends:** ADR-0008 (a second factor for privileged roles). Its decisions
stand; what changes is who may switch the requirement, and from where.

## Context

`roles.requires_mfa` has been editable only by `RoleSeeder` since ADR-0004
made roles data. There is no request field for it, no resource field, no
control on the Roles page — the column is real, load-bearing, and reachable
only from a database client.

The owner, 22 August 2026:

> we want in the settings to taggle on and off the 2FA

This is not a convenience request. It is the consequence of a gap that has
already cost real time, three times over.

### What the gap actually causes

**MFA has been switched by hand at least three times** — off on 18 August, back
on on 21 August, off again on 22 August — and the mechanism each time was
either a raw `UPDATE` or a `RoleSeeder` re-run.

**A `RoleSeeder` re-run is not a safe way to do it**, and that was proved
during `K3` on 22 August. Adding a permission to the enum requires re-seeding
roles for any existing role row to receive it; that re-seed *also* rewrites
`roles.requires_mfa`, which switched MFA back on for Super Admin and Finance
on an environment where it had deliberately been relaxed. **Three console
accounts moved to "must enrol" as a side effect of granting an unrelated
permission**, and nothing in the symptom resembled MFA.

**The half-state is the expensive one.** `mustEnrolInMfa()` is
`requiresMfa() && ! hasMfaEnabled()`. A user in that state signs in
successfully — a 200 *with a token* — and is then refused every route but
five by `EnsureMfaEnrolled`. Nothing about that looks like a second factor. An
operator who cannot see the requirement anywhere in the product has no way to
diagnose it.

## Decision

### 1. Two switches, and one resolved answer

- **`auth.mfa_enforced`** — a platform-wide setting. Default **true**.
- **`roles.requires_mfa`** — per role, as today, now editable through the API.

`User::requiresMfa()` becomes the **single place** both are resolved:

```php
return Settings::mfaEnforced() && (bool) $this->roleRecord?->requires_mfa;
```

**Nothing else may read either switch to decide whether a person needs a
second factor.** Two callers reading two columns and combining them
themselves is how the two gates drift apart, which is exactly the confusion
this ADR exists to end. `EnsureMfaEnrolled`, the login flow and the console
all ask `requiresMfa()` / `mustEnrolInMfa()` and never the settings directly.

### 2. The master switch relaxes; it never tightens

`mfa_enforced = false` suspends the requirement everywhere. It does **not**
disable anybody's existing second factor, delete a secret, or unenrol a
person: somebody who has set one up keeps using it, and their login is
unchanged. Turning it back on returns every role to whatever
`requires_mfa` already said.

This asymmetry matters. A switch that could *both* relax and tighten silently
would mean flipping one boolean could lock every administrator out of the
platform at once. Relaxing is recoverable; being locked out of the console
that holds the switch is not.

### 3. The console shows the effective answer, never the two inputs

A checkbox reading "Super Admin: required" while the master switch is off is a
lie the shape of a fact. The settings screen shows, per role, **what will
actually happen at the next sign-in** — and it says how many accounts are
affected before anything is saved.

### 4. Turning it on names who it will lock out

Enabling the requirement for a role puts every unenrolled holder of that role
into the half-state at their next sign-in. So the console **counts them and
says so before saving**: *"3 people will be asked to enrol."*

That count is the whole safety of this feature. Without it, the switch is a
trap that fires later, on somebody else, at a moment nobody connects to this
action.

### 5. Only head office, and it is audited

`settings.manage` plus `access_level = kangaru`. A fleet's Super Admin may not
relax the second factor on their own account — that is the same shape as
`support.act-as` and the fleet register (ADR-0059 §1), and for a sharper
reason: a control that weakens authentication must not be reachable by the
account it would weaken.

Every change writes an audit row naming the actor, the role and the direction.

### 6. `RoleSeeder` stops being the only way, and stops being a safe way

Editing a role through the API is now the supported path. The seeder still
writes `requires_mfa` when it creates a role — a new role needs a starting
value — but **re-running it against an existing environment overwrites an
operator's decision**, and that is recorded in `Modules/Fleet/README.md` and
here rather than left to be rediscovered.

## Consequences

- **`AGENTS.md`'s Security line is amended**, not deleted: Super Admin and
  Finance still *default* to requiring a second factor, and a fresh
  installation behaves exactly as it does today.
- **`SettingsService` gains one key**, `auth.mfa_enforced`, not public — the
  login screen must not advertise that the platform's second factor is off.
- **`RoleResource` and the role requests gain `requires_mfa`.** The Roles page
  becomes the per-role surface; System settings holds the master switch and
  the effective summary.
- **A test asserts the two switches resolve in one place.** Mutating either to
  be read independently must turn it red.
- **The demo-account MFA helper is unaffected.** `enrolDemoMfa()` sets up a
  factor; whether one is *required* is this decision's business, not its.

## Alternatives considered

**A master switch only.** Simplest, and it cannot express "keep Finance
protected while relaxing Super Admin" — which is the state the owner has
actually wanted twice, and the reason the roles carry the column at all.

**Per-role only, no master switch.** Closer to today and misses the case that
prompted this: relaxing everything at once, quickly, without visiting four
roles and hoping none was missed. It also gives no single thing to turn back
on afterwards.

**Leave it in the database.** What ships today. It has been changed by hand
three times, gone wrong once as a side effect of an unrelated seeder run, and
is invisible to the person accountable for the decision.

**A time-boxed relaxation that re-arms itself.** Genuinely safer — the failure
mode of this feature is somebody relaxing MFA "for an hour" in 2026 and
finding it off in 2027. Rejected for now because a scheduled re-arm that locks
administrators out unattended is a worse failure than a switch somebody
forgot, and the audit trail plus the effective-state display are what make the
forgetting visible. Worth revisiting once the notification loop can warn about
it.
