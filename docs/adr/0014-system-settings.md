# ADR-0014: System Settings

**Status:** Accepted (4 August 2026 — owner requested the feature and its
scope directly, including groups this ADR stages rather than ships)

**Depends on:** ADR-0004 (permission model — `settings.manage` joins the
catalogue), ADR-0011 (every endpoint lands in the contract), ADR-0012
(the public order throttle "moves by config" — this is that config's
home), ADR-0013 (SMTP unblocks the customer password reset it deferred).

## Context

The platform has no owner-editable configuration. The brand name is
hard-coded in components, the contact email appears verbatim three
times in the frontend, mail goes to a log file, and the walk-in rate
limit that ADR-0012 promised would "move by config" is a literal in a
route file. The owner asked for a System Settings surface covering
branding, regional defaults, ordering and booking controls, SMTP, SMS
gateways, payment gateways, and mobile-app configuration.

Two of those collide with standing decisions. AGENTS.md's security
posture warns against SMS flows (SMS-pumping fraud); payments are
deferred behind their own future ADR by both ADR-0005 and ADR-0012.
This ADR does not overturn either — it builds the shelf and leaves
those two boxes closed.

## Decision

**One `settings` table, grouped key-value, read through a cached
service, written only through audited, permission-gated endpoints.
Secrets are write-only. A whitelisted public endpoint serves the
branding subset.**

### 1. Storage and catalogue

`settings`: `group`, `key` (unique together), JSON `value`,
`is_secret`, timestamps. The **catalogue lives in code** —
`SettingsService::CATALOGUE` names every legal group/key with its
default, exactly as ADR-0004 keeps permissions in code: a row invented
in the table means nothing because nothing reads it, and a settings
screen rendering unknown knobs would be worse than none. Unknown keys
are rejected on write.

### 2. Reads are cheap, writes are rare

`SettingsService::get()` reads through a single cache entry, flushed on
write. Callers never query the table directly.

### 3. Secrets are write-only

A key marked secret in the catalogue is stored via Laravel's
`encrypted` cast and **never leaves the server** — GET returns
`configured: true|false` in its place, and audit rows record `***` for
both before and after. Phase 1 ships no secret keys; the rule exists
from day one so SMTP/SMS/payment credentials inherit it rather than
negotiate it.

### 4. Authorization and audit

New permission `settings.manage`, group Administration, held by Super
Admin (who holds everything). GET and PATCH both require it — settings
include operational levers, so even reads are not for every role. Every
write lands in the append-only audit log with before/after, the same
trail rate cards and roles use.

### 5. The public subset

`GET /api/v1/public/settings` returns the branding whitelist only (app
name, tagline, meta description, contact email/phone, logo and favicon
URLs, currency) so the landing page, login screen and document head
stop hard-coding them. The whitelist is a constant in code; nothing
outside it can be exposed by adding rows. Cached like every other read,
throttled like every public route.

### 6. Asset uploads

Logo and favicon upload as multipart to a dedicated endpoint (same
pattern as the odometer photo), stored on the public disk, referenced
by path in settings, served as absolute URLs by the public endpoint.

### 7. Staged groups

Ordering/booking controls (phase 2), SMTP (phase 3 — unblocks
ADR-0013's password reset), SMS gateway (phase 4 — credentials may be
stored; **enabling SMS flows needs its own decision** per AGENTS.md),
payment gateways (phase 5 — slots only; **enabling payments needs the
payments ADR**), mobile-app settings (phase 6 — when an app exists).
Each phase extends the catalogue; none changes this architecture.

## Consequences

- The frontend gains one public settings fetch; everything branded
  reads from it. A misconfigured backend degrades to the compiled-in
  defaults, never to a blank page.
- The settings screen is Super Admin's today. Loosening that later is a
  role-editor action (grant `settings.manage`), not a release.
- Audit rows for settings changes are the platform's first with masked
  values; the masking lives in one place (`AuditLog::record`'s caller).

## Alternatives considered

**A config file edited over SSH.** Free, and invisible to the audit
log, unversioned per-change, and inaccessible to the owner. Rejected.

**One row per group as a JSON blob.** Fewer rows, but a write to one
key rewrites siblings, audit diffs become blob diffs, and per-key
secrecy is lost. Rejected.

**Env vars surfaced in a UI.** Env is deploy-time and per-machine;
settings are runtime and platform-wide. Mixing them makes both worse.
Rejected.
