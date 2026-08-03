# ADR-0010: Voluntary MFA, and Running Out of Recovery Codes

**Status:** Accepted (3 August 2026)

**Depends on:** ADR-0008 (Accepted, built). TOTP second factor, required for
Super Admin and Finance via `roles.requires_mfa`.

**Resolves:** the two things ADR-0008 shipped incomplete — a voluntary
enrolment that the login flow ignores, and
`MfaService::RECOVERY_CODE_LOW_WATER_MARK`, which is defined and read by
nothing.

## Context

### A second factor that is never asked for

`POST /auth/mfa/enrol` is gated on **authentication**, not on role. Any
signed-in user may enrol, and the flow works end to end: they scan the QR,
confirm a code, receive ten recovery codes, and `GET /auth/me` then reports
`mfa_enabled: true`.

Login does not agree. `AuthService::login()` reads:

```php
if ($user->requiresMfa() && $user->hasMfaEnabled()) {
```

`requiresMfa()` is the **role's** `requires_mfa` column. A Corporate Admin
who enrolled satisfies the second condition and fails the first, so they are
handed a token with no challenge — at every subsequent sign-in, forever.

This is worse than not offering enrolment at all. The platform is not merely
failing to protect the account; it is **telling the holder it is protected
when it is not**. Somebody who deliberately turned on a second factor, wrote
down ten recovery codes and filed them has been given a placebo. The next
person to discover it will be an auditor.

It is also not a gap in coverage. PROJECT.md defers *requiring* MFA for
non-privileged roles; nothing anywhere says a user may not have one.

### A warning nobody receives

`RECOVERY_CODE_LOW_WATER_MARK = 3` exists with a docblock explaining that
below it "a lost phone plus a mislaid sheet is an unrecoverable account".
Nothing reads the constant. `MfaService::remainingRecoveryCodes()` exists
and nothing calls it. `POST /auth/mfa/recovery-codes` regenerates them and
nothing tells anybody to.

So a user spends codes one at a time, each `verifyChallenge` silently
striking one off, and discovers the count only by running out — at which
point they have lost their phone, have no code left, and **no administrator
can help**, because ADR-0008 puts resetting somebody's second factor out of
scope on purpose.

### Why these are one decision and not two

Honouring voluntary enrolment increases the number of accounts that can lock
themselves out permanently. Today that population is exactly the Super
Admins and Finance officers who had no choice; afterwards it is anybody who
opted in. Shipping the first without the second would take a hazard that
currently applies to a handful of deliberate accounts and spread it to
anyone who reads a security tip — which is why the low-water warning stops
being optional the moment voluntary MFA becomes real.

## Decision

### 1. Login honours the factor, not the role

```php
if ($user->hasMfaEnabled()) {
```

Anyone with a confirmed second factor is challenged for it. The role column
keeps deciding who **must** enrol; it stops deciding who **gets asked**.

`requiresMfa()` is unchanged and still drives `mustEnrolInMfa()` and the
`EnsureMfaEnrolled` middleware, so nobody new is forced into enrolment. The
change is only that an existing factor is used.

### 2. Voluntary means voluntary in both directions

A user whose role does **not** require MFA may turn it off, by proving a
current code. A user whose role requires it may not, and gets `403`.

This is not a convenience. Without it, decision 1 sets a trap: an
unprivileged user could switch a second factor on, and then neither turn it
off nor find an administrator able to — every account that opted in would be
one lost phone away from being unrecoverable, and the platform would have
made that irreversible on their behalf. An opt-in that cannot be reversed by
the person who opted in is not voluntary.

Proving a code first is what keeps this from being a downgrade path: an
attacker holding a stolen session cannot strip the factor without already
holding the factor.

### 3. Remaining recovery codes are stated, and lowness is a flag

`UserResource` gains `mfa_recovery_codes_remaining` (int) and
`mfa_recovery_codes_low` (bool, true at or below the existing threshold of
three). Both are `null`/`false` for an account with no factor.

The server states the count and the verdict; the client decides how loudly
to say it. The threshold lives in one place — `MfaService`'s constant, which
finally has a reader — so a screen cannot disagree with the rule about what
"low" means.

**Codes are not regenerated automatically.** Silently replacing a set would
invalidate the printed sheet the holder is relying on, at the exact moment
they are relying on it. The endpoint to regenerate already exists; this
decision only ensures somebody is told to use it.

## Consequences

**Retroactive at next sign-in.** Any account already voluntarily enrolled
begins being challenged. Outside tests and the demo seed that is currently
nobody, but the same sentence was true of ADR-0008's token expiry and it
still deserves saying: this changes the behaviour of existing accounts
without a migration.

**A new way to be locked out, deliberately accepted.** More accounts can now
hold a factor, so more accounts can lose one. Decision 2 is the escape
hatch, decision 3 is the early warning, and ADR-0008's refusal to build
administrator reset stands — an administrator who can strip a second factor
is a second factor an administrator can strip.

**Enrolment stays open to every authenticated role.** The alternative was to
close it, and that is rejected below.

**`mfa_enabled` becomes true information.** It has always been returned; it
has not always been true. Nothing about the field changes and everything
about its meaning does.

**Demo accounts are unaffected.** Super Admin and Finance are required
either way, and the two-step demo login behaves exactly as before.

## Scope

**In:** the login predicate; disabling a factor when the role does not
require one; the two resource fields; tests for each, including that a
privileged user cannot disable.

**Out, deliberately:**

- **Administrator reset of somebody's second factor.** ADR-0008 puts it out
  of scope and this ADR does not reopen it.
- **Requiring MFA for more roles.** PROJECT.md lists that as out of Phase 1;
  moving it needs an owner-approved scope change, not this.
- **Notifying anybody out of band** when codes run low. The count is on
  `/auth/me`; an email or an inbox notification is `Modules/Notifications`
  work and a separate question about notification fatigue.
- **A UI.** The fields and the endpoint; the screen follows, as ADR-0006 and
  ADR-0009 both did.

## Alternatives considered

**Refuse enrolment from roles that do not require a factor.** The other
obvious fix, and the one that leaves the login code untouched. Rejected: it
answers "the platform lies about being protected" by removing the ability to
be protected. A Corporate Admin manages their company's users and approves
its bookings — a worthwhile account to compromise — and a bank's vendor
security questionnaire asks whether users *can* enable two-factor
authentication, where "no" is a materially worse answer than "yes,
optionally". It also fixes the symptom in the wrong module: the defect is
that login consults the role instead of the factor, and it would still be
consulting the wrong thing afterwards.

**Honour voluntary MFA but refuse to let anyone disable it.** Simpler, and
consistent with privileged accounts. Rejected as the trap described in
decision 2 — it makes an opt-in irreversible for the one population that
had a choice, with no administrator able to undo it.

**Automatically regenerate when the last code is spent.** Attractive because
nobody can then run out. Rejected: the new codes are only ever legible once,
and generating them during a login the user is already struggling through
means they are displayed to somebody who has lost their phone and is not
expecting a new sheet. The set they printed would also stop working without
their knowing, which is the failure this is meant to prevent.

**Lower the threshold to one.** Rejected: a warning that arrives with one
code left arrives after the useful moment. Three is what ADR-0008 chose and
nothing since suggests it was wrong; the defect was never the number.
