# ADR-0028: Admin-governed sign-in methods

**Status:** Accepted (10 August 2026)

**Amends:** ADR-0016 (driver sign-in accounts) — narrowly, on password
reset; §2 below says exactly which sentence moves and why the reasoning
behind it does not.

**Depends on:** ADR-0014 (settings — the `mail` group this rides on and the
catalogue the new group joins), ADR-0022 (token scope), ADR-0027 (driver
applications — social sign-in for a stranger lands there, not in `users`).

## Context

The Driver App's welcome screen offers three ways in: email, Google,
Facebook. Its sign-in screen offers "Forgot password?". As of this ADR's
writing, the last three are honest refusals — the buttons explain that
nothing is connected.

The owner wants them real, and wants them **owned**: the Super Admin decides
from the console which methods are on, and supplies the credentials they run
on. That instinct is correct and this ADR builds around it. A sign-in method
is an attack surface; turning one on should be a deliberate, audited act by
the person accountable for the platform, not a deploy-time constant.

Two standing decisions constrain the design:

- **ADR-0016** refused self-service password reset, reasoning that "an
  administrator silently changing another person's credentials is the one
  act an audit trail cannot tell apart from impersonation."
- **ADR-0027 §1** established that self-service never mints a principal: an
  application is not an account, and approval is the only thing that creates
  one.

AGENTS.md's security posture rules out SMS flows (SMS-pumping fraud is a
real cost in East Africa), which settles the reset channel question before
it is asked: email, via the SMTP the admin already configures under
ADR-0014 phase 3, or nothing.

## Decision

**A new `auth` settings group governs every method. The app renders its
front door from the public subset of that group, fail-closed. Reset is an
emailed one-time code. Social sign-in authenticates existing drivers and
routes strangers into the ADR-0027 application queue.**

### 1. The `auth` settings group

Joins the ADR-0014 catalogue, edited under `settings.manage`, audited like
every group:

| Key | Default | Public | Notes |
|---|---|---|---|
| `password_reset_enabled` | `false` | yes | also requires `mail.enabled` to act |
| `google_enabled` | `false` | yes | |
| `facebook_enabled` | `false` | yes | |
| `google_client_ids` | `''` | no | comma-separated OAuth audiences the server accepts |
| `facebook_app_id` | `''` | no | |
| `facebook_app_secret` | `null` | no | **secret** — write-only, encrypted at rest |

Only the three booleans are public. The app shows a button because the
server said so this morning, and hides it when it cannot ask — a method
that fails closed on a dead connection is a method that cannot be
resurrected by a stale client. Credentials never cross the public endpoint;
the secret inherits ADR-0014 §3's write-only rule.

Enabling a method whose credentials are absent is legal to *save* (the
catalogue validates shape, not readiness) and inert in practice: the
endpoints below refuse with `AUTH_METHOD_DISABLED` until both the flag and
its prerequisites hold. A switch that silently half-works teaches people to
stop trusting switches; one that answers "here is what is missing" teaches
them to finish the job.

### 2. Password reset, and what happens to ADR-0016's refusal

ADR-0016's sentence — "there is no password reset for somebody else" —
stands untouched for administrators. What it protected against was a
*person with power* silently taking over a credential. An emailed code
proves the opposite of impersonation: possession of the driver's own
mailbox. The part of ADR-0016 that falls is only the practical consequence
("a driver who forgets theirs gets a new one issued"), and it falls because
its stated premise — no mail delivery existed — is now false whenever the
admin has configured SMTP.

The flow, `POST /api/v1/auth/password/forgot` `{email}`:

- Throttled 3/min/IP, and per-email: one live code at a time, reissue only
  after its cooldown.
- **Answers an identical 202 whether or not the email is known** — the same
  oracle-refusal as ADR-0027 §5, protecting the same population.
- If the account exists and is active: a 6-digit code, stored **hashed** in
  Laravel's `password_reset_tokens` (created for this and idle since the
  scaffold), 15-minute expiry, mailed through the ADR-0014 settings-built
  mailer — never boot-time config.

`POST /api/v1/auth/password/reset` `{email, code, password,
password_confirmation}`:

- Throttled 5/min/IP. Code single-use; five failed attempts burn it.
- Success sets the password and **revokes every token the account holds**,
  exactly as the in-app change does and for the same reason: a reset that
  leaves a stolen session alive has reset nothing.
- Same `Password::min(12)` floor as everywhere else.

Both endpoints answer `409 AUTH_METHOD_DISABLED` when the flag is off or
mail is not configured. Staff accounts may use the flow too — resetting a
password never touches MFA, so a Finance account still meets its second
factor at the next login (ADR-0008 is undisturbed).

Customer reset (ADR-0013's deferral) is not built here, but the blocker it
named is now gone; lifting it is a small follow-up against the same mailer.

### 3. Social sign-in: verification is the server's, identity is the platform's

The app performs the native flow and hands the resulting proof to
`POST /api/v1/auth/social` `{provider, token, client: "driver"}`. The
server never trusts the phone's word for who signed in:

- **Google:** the ID token is verified against Google's own endpoint, and
  its audience must be one of `auth.google_client_ids`.
- **Facebook:** the access token is verified via `debug_token` with the
  stored app credentials, then the profile is fetched server-side.

Resolution, in order, each step deliberately narrow:

1. **A linked identity exists** (`social_identities`: `user_id`,
   `provider`, `provider_id` unique, `email_at_link`) → sign in, minting
   the same driver-scoped token as a password login (ADR-0022 unchanged).
2. **No link, but the provider-verified email matches a `users` row** →
   link and sign in, **only if** the account can drive
   (`trips.transition.own`, the ADR-0016 §2 test). Matching is only
   honoured when the provider asserts the email is verified — an
   unverified assertion is an account-takeover kit. Staff and Finance
   accounts always refuse this path: a method that has no second factor
   must not open doors that require one.
3. **No account at all** → `202` with the verified name and email, and
   **no principal is created**. The app routes into the ADR-0027
   application form, pre-filled; phone and consent are still collected;
   the office still approves. Social sign-up is a faster pen for the same
   form, not a side door around the queue.

MFA-challenged logins (ADR-0010's voluntary enrolment) refuse the social
path with the same message the password path uses — the app cannot
complete that exchange, and pretending otherwise on a second route would
be a bypass.

### 4. What the app shows

The welcome and sign-in screens read the three public flags (cached with
the same day-long persistence as everything else, so a driver who opened
the app yesterday sees yesterday's truth rather than nothing). "Forgot
password?" navigates to the reset flow when enabled and keeps today's
honest explanation when not. Buttons for disabled methods are absent, not
greyed: a control that exists only to refuse is furniture.

## Consequences

The Super Admin can turn each method on from the console, watch the audit
trail record it, and turn it off again in one PATCH — including in anger,
during an incident, without a deploy. That last property is the quiet
argument for the whole design.

Real Google and Facebook credentials must be created in their respective
consoles by the owner; the platform stores and uses them but cannot mint
them. Until they are pasted in, the flags are inert and the app says so.

`social_identities` is a new table this ADR owns. The reset flow occupies
`password_reset_tokens`. Two new error codes join the enum:
`AUTH_METHOD_DISABLED` and `SOCIAL_TOKEN_INVALID`.

## Alternatives considered

**SMS one-time codes.** Refused without discussion: AGENTS.md names SMS
pumping as a real regional cost, and ADR-0014 phase 4 stores gateway
credentials precisely so that *enabling* SMS remains its own future
decision. This ADR does not make it.

**Admin-set temporary passwords as the reset story (status quo).** Kept as
the fallback when mail is off, but inadequate as the only story: it scales
with office hours, and ADR-0027 just invited a fleet of self-registered
drivers who chose their own credentials and have no desk to walk up to.

**Laravel Socialite.** Built for server-side redirect flows; the app's
native flows hand over tokens, not redirects. Verifying tokens directly
against the providers is less machinery and the same guarantee.

**Auto-creating accounts from social identities.** Rejected — it repeals
ADR-0027 §1 by side door. An identity Google vouches for is still a
stranger until the office says otherwise.

**Per-tenant social configuration.** Meaningless here: drivers are
platform-level (ADR-0005/0016 §6), so the platform owns the credentials.