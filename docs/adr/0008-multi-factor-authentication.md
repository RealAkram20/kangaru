# ADR-0008: Multi-Factor Authentication for Privileged Roles

**Status:** Proposed

**Implements:** AGENTS.md Security — *"MFA is required for Super Admin and
Finance roles in Phase 1 — these roles can move money and change rates."*
PROJECT.md repeats it against both roles and puts MFA for everyone else
out of Phase 1.

## Context

This is the oldest unmet **stated requirement** in the repository. Every
other gap is an improvement somebody wants; this one is a rule the project
wrote for itself, about the two roles that can issue an invoice, credit an
invoice and set a price, for a client that is a bank.

### What exists today

One step. `POST /auth/login` takes an email and a password, throttled at
5/minute/IP, and returns a Sanctum token:

```php
$token = $user->createToken('api')->plainTextToken;
```

`AuthService` is already careful in the places it can be: a suspended
account is refused with the *same* exception and message as a wrong
password, and the status is checked **after** the hash so the response
time does not distinguish them either. That care is what makes the missing
second factor conspicuous rather than merely absent.

### Two findings that shape the decision

**1. Sanctum tokens never expire.** `config/sanctum.php` has
`'expiration' => null`, against AGENTS.md's *"Sanctum tokens with expiry"*.
This is not a separate tidy-up — it decides how much MFA is worth. A second
factor that mints a token valid forever protects the *login* and nothing
after it: one leaked token from one machine and the factor is irrelevant
for the life of the account. **MFA without token expiry is theatre**, and
this ADR treats them as one change.

**2. There is no password reset for another user, deliberately.**
`Modules/Administration/README.md` records it: an administrator silently
changing someone else's password is the one act an audit trail cannot tell
apart from impersonation. That is the right call, and it means a Super
Admin who loses their authenticator has **no recovery path at all** — the
only account that can fix them is the one that is locked out. Recovery
codes are therefore not a nicety here; without them this ADR ships a way
to permanently destroy a platform.

## Decision

**Not taken.** Proposed for the owner, because two of the choices below are
product judgements about who gets locked out of what, not engineering
trade-offs.

### 1. The factor is TOTP (RFC 6238). Not SMS.

AGENTS.md argues against SMS in its own security section — *"OTP/SMS
endpoints aggressively limited (SMS pumping fraud is a real cost in East
Africa)"* — and that is only the cost objection. SMS is also the weakest
common second factor: a SIM swap defeats it, and the platform would be
paying per message for the privilege.

Email OTP is worse than it looks: email is the channel a password reset
would travel over, so an attacker who holds the mailbox holds both factors.

TOTP costs nothing per use, works with no network — which matters for a
platform whose own risk register names upcountry connectivity — and needs
no vendor.

**Library:** `spomky-labs/otphp` for the codes and `bacon/bacon-qr-code`
for the enrolment QR. Not Laravel Fortify: it brings routes, views and a
session-based flow for a Blade application, and this is an API consumed by
a React client.

### 2. No API token is issued before the second factor

Login splits, and the intermediate state is **not a token**:

- `POST /auth/login` with correct credentials for an MFA-required user
  returns `202` and a short-lived, single-use `challenge_id` — no
  `plainTextToken`, no abilities, nothing that authenticates a request.
- `POST /auth/mfa/verify` exchanges `challenge_id` + a 6-digit code for
  the token.

The alternative — mint a token with an `mfa-pending` ability and upgrade it
— is how this is often done and is rejected here. A partial token is a
token: it is bearer credential material that exists before the factor was
proved, and every endpoint then depends on an ability check nobody will
remember to write. Fail-closed is easier when the thing does not exist yet.

Challenges expire in **5 minutes**, are single-use, and are rate-limited
per account as well as per IP — the login throttle is per IP, which does
nothing against a distributed attempt on one known Finance account.

### 3. Enrolment is forced, not nagged

A user in an MFA-required role who has not enrolled can authenticate and
then do **nothing except enrol**. Every other endpoint refuses them.

The alternative is a banner and a grace period, which in practice means the
requirement is unmet for as long as somebody ignores it — and the person
most likely to ignore it is the busiest, who is usually the one with the
most access. A grace period is a decision to be non-compliant on a
schedule.

**This is the first choice that wants your agreement**, because it means an
existing Finance officer is stopped at their next login until they have an
authenticator app to hand.

### 4. Recovery codes: ten, single-use, hashed, shown once

Hashed like passwords, not encrypted — nothing ever needs to read them
back. Displayed exactly once at enrolment, regenerable by the holder, and
each one usable a single time.

Using one is an audited event, and using one **re-arms nothing**: it gets
you in, and the audit log says so. Falling below three remaining prompts a
regeneration.

Per the Context, without these a lost phone is an unrecoverable Super
Admin. With them, a printed sheet in a drawer is the recovery path, which
is the correct trade for an account that cannot be reset by anybody else.

### 5. Token expiry moves with it

`config/sanctum.php` gains an expiry. **24 hours** proposed: long enough
that a dispatcher is not re-authenticating mid-shift, short enough that a
leaked token is not a permanent grant.

**This is the second choice that wants your agreement**, because it is the
one every user feels daily and the number is a judgement rather than a
derivation.

Expiry applies to **all** roles, not only MFA'd ones — it is AGENTS.md's
rule for Sanctum generally, and a never-expiring Corporate Admin token is
its own problem.

### 6. The secret is encrypted at rest

`users.mfa_secret` is app-level encrypted, the same treatment AGENTS.md
requires for driver documents. A TOTP secret in plaintext is a second
factor anybody with a database dump can compute.

### 7. Enrolment, reset and recovery-code use are audited

`Auditable` already writes a before/after diff on `User`. The secret must
be **excluded from the diff** — an audit log that records the TOTP secret
in its `changes` column has moved the problem rather than solved it, and
`audit_logs` is append-only, so a mistake there is not deletable.

The mechanism exists: `AuditLog::diffForUpdate()` strips
`$model->getHidden()` from the changed keys, so adding `mfa_secret` and
`mfa_recovery_codes` to `User::$hidden` excludes them from every audit row
and from serialisation in one move. It needs a test that asserts it,
because the failure is silent and permanent.

## Consequences

**The demo seed breaks unless it is handled.** `superadmin@kangaruride.test`
and `finance@kangaruride.test` are both MFA-required under this decision,
and `migrate:fresh --seed` currently produces accounts anyone can sign into
with `password`. Either the seeder enrols them with a fixed, documented
secret, or demo accounts are exempted by environment. The first is
preferable and must be **local/staging only** — a known TOTP secret in
production is worse than no TOTP at all.

**The Bank demo path is unaffected.** `admin@centenarybank.test` is a
Corporate Admin, which is not an MFA-required role. PROJECT.md's six
acceptance criteria are demonstrated through that account and stay a
single-step login.

**Most tests are unaffected, and that is a risk.** They use `actingAs()`,
which bypasses HTTP login entirely, so the suite will keep passing while
the login flow changes underneath it. The isolation tests will not notice.
That makes explicit login-path tests part of the work rather than a
follow-up: an MFA-required user who is handed a token without verifying is
the failure this whole ADR exists to prevent, and nothing currently in the
suite would see it.

**Recovery becomes an operational procedure**, not code. Somebody has to
decide where the printed codes live. That belongs in the deploy runbook
AGENTS.md already asks for.

**It answers a question the Bank will ask.** AGENTS.md wants a living
vendor-security-questionnaire document. "Is MFA enforced for privileged
users?" is on every one of them, and the answer today is no.

## Scope

**In:** TOTP enrolment and verification, the two-step login, forced
enrolment for the two roles, recovery codes, Sanctum token expiry, secret
encryption, audit events, and login-path tests.

**Out, deliberately:**

- **MFA for other roles.** PROJECT.md puts it out of Phase 1 explicitly.
  The mechanism should be a per-role flag from the start so extending it is
  configuration rather than a release.
- **WebAuthn / passkeys.** Strictly better than TOTP — phishing-resistant,
  no shared secret — and the right destination. It needs device support,
  a browser API and a materially larger enrolment UI, and it should not
  block a requirement that is already overdue. Worth its own ADR later;
  the two coexist.
- **Trusted devices / "remember this browser".** Real convenience, and it
  is a decision about how long a second factor stays proved. Adding it at
  the same time as the factor itself makes both harder to reason about.
- **Step-up authentication** — re-proving the factor for a single dangerous
  act (issuing a credit note, changing a rate card) rather than once per
  session. Arguably where this should end up for money operations, and
  properly a separate decision once session-level MFA exists.
- **Admin-initiated MFA reset.** It is the same hazard as resetting
  somebody's password, and it needs the same answer, which the
  Administration README says nobody has given yet.

## Alternatives considered

**Laravel Fortify.** Ships TOTP, recovery codes and the enrolment flow,
well-tested and maintained. Rejected because it is built around a
session-authenticated Blade application: it registers its own routes and
views, and bending it into a token API means using a third of it and
fighting the rest. The portion actually needed here is a code comparison
and a QR image.

**SMS one-time codes.** Familiar to every user in the market and needs no
app. Rejected on AGENTS.md's own grounds — SMS pumping fraud is named in
the security section as a real regional cost — plus SIM-swap weakness and a
per-message bill for a control that is meant to be always on.

**Email one-time codes.** Free and needs no app. Rejected: it collapses two
factors into one mailbox.

**A grace period before enforcement.** Kinder to existing users. Rejected
in Decision 3: it is a schedule for being non-compliant, and the users who
ignore it longest are the ones with the most access.

**Doing token expiry separately, later.** Smaller change now. Rejected: a
second factor that yields a permanent credential secures one moment and
nothing after it, so shipping MFA alone would let the project claim a
control it does not really have.
