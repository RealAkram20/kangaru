# ADR-0054: Error and performance tracking, and what it is allowed to see

**Status:** Accepted — 21 August 2026

**Depends on:** ADR-0001 (tenancy), ADR-0008 (MFA — its enrolment payload is
why the secret scrubber exists), ADR-0011 (contract or it does not exist),
W1-e and `docs/data-inventory.md` (the data-protection package).

**Amends** `docs/data-inventory.md` §5 (a new processor), §8 (two new
obligations) and the public privacy notice.

## Context

The owner: *"the system gets errors, sluggish, and I want us to know what is
happening with the app."*

**The complaint was measured before it was instrumented**, because "add
monitoring" is the kind of request that can quietly replace finding out what
is wrong. `https://kangaruride.com/` serves a **2,169-byte static
`index.html`** at **0.69 s / 1.69 s / 0.69 s** time to first byte over three
consecutive samples. That is a static file behind Cloudflare and Traefik, it
should be tens of milliseconds, and the 2.4× spread between samples says more
than the mean does. Every console page load begins with it.

So there is a real problem, this platform has no way to see it, and the
existing observability is `LOG_CHANNEL=stack` writing JSON to a container's
stderr — which answers "what happened" only for somebody already logged into
the server, after the fact, with no aggregation and no timing.

## Decision

### 1. Sentry, EU region, on all three apps

`sentry/sentry-laravel` on the API, `@sentry/react` on the web app,
`@sentry/react-native` on the driver app.

**The EU region is the part that cannot be changed later.** A Sentry
organisation's data region is fixed at creation; `ingest.de.sentry.io` means
Frankfurt, `ingest.us.sentry.io` means the United States. Given the anchor
client is a bank and the Uganda Data Protection and Privacy Act, 2019 applies,
Frankfurt is the defensible answer and it costs nothing to choose.

Self-hosting was offered and refused on cost of operation: Sentry's own stack
needs roughly 4 GB of RAM and a dozen containers, and the server already runs
eight at about 3.9 GB. It would have meant a second machine.

**The driver app is not a config change.** `@sentry/react-native` is native
with a config plugin, so it needs a rebuild and a fresh signed APK on every
handset. That was said plainly before it was chosen; it rides along with Track
B's first build rather than forcing one.

### 2. Full request data — the owner's decision, taken against advice

`SENTRY_SEND_DEFAULT_PII=true`. A captured event carries the request body:
passenger name, phone, pickup and drop-off, the signed-in user's id and email.

Two options were put to the owner:

- **Scrubbed** — stack trace, route, SQL shape and timing, no personal data.
  *Recommended.*
- **Full request data** — richer reports; you see the exact address that broke
  the geocoder. **Chosen.**

It is written down as a decision rather than a default because it is one, and
because the person who reads this file in six months is entitled to know that
the alternative existed and who declined it. The consequences are not
optional and are discharged as part of this change:

- `docs/data-inventory.md` §5 names Sentry as a processor and lists what
  reaches it.
- The **public privacy notice discloses it in plain words** — *"it includes
  what you had entered on the form at that moment"*. The page already claims
  "we run no analytics trackers", and that sentence stays true only if the one
  thing that is sent is named rather than softened into "technical error
  information".
- `docs/data-inventory.md` §8 gains two obligations that this repository
  cannot discharge: a data-processing agreement with Sentry, and the project's
  retention setting in Sentry's own console.

### 3. Credentials are scrubbed regardless, and that is not the same decision

`App\Support\Observability\ScrubsSecrets` runs as `before_send` and redacts
passwords, tokens, `Authorization` headers, cookies, TOTP secrets, recovery
codes, challenge ids, API keys and idempotency keys — **whatever
`send_default_pii` is set to**.

This is deliberately not governed by §2, and the distinction is the whole
point: **personal data is a decision with a trade-off; a credential in a bug
report is a security defect.** They travel in the same request body, which is
the only reason anyone would treat them as one setting.

Idempotency keys are in the list although they are not secrets: a leaked one
lets somebody replay a financial mutation, since AGENTS.md requires replays to
return the original result.

Client-side rather than Sentry's own server-side scrubbing, which would also
work — this way the value never crosses the wire, so it cannot be read from a
proxy, a request log, or an account later shared with a contractor.

**Matched on key names, not value shapes.** A regex over values would have to
recognise a six-digit TOTP code, which is indistinguishable from a passenger
count, a house number or a year. Keys are what this codebase controls, and
adding a credential field means adding a line here — a thing review can see.
Seven tests cover it and two mutations were proved against them.

### 4. Sampling: every error, a tenth of transactions

`sample_rate` 1.0, `traces_sample_rate` 0.1 on all three apps.

Errors are the thing being asked for and an error nobody sees is the problem.
Tracing is billed per transaction, and a 1.4 s page load is as visible in a
tenth of samples as in all of them. Turning it up is for a hunt, not a
default.

### 5. Reporting never changes a response

`Integration::handles($exceptions)` hooks Laravel's *reporting* channel, which
runs before rendering and independently of it. Every existing `render()`
callback in `bootstrap/app.php` still produces this platform's own error
envelope, so **no client sees a different response because observability was
switched on**. A monitoring tool that alters what an API returns is one that
has to be trusted inside the request path, and this one does not need to be.

With no DSN the SDK short-circuits, so a developer without one — and CI —
behave exactly as before. That is why none of this needed a test-environment
mock.

### 6. The release is the commit

`release` comes from `APP_BUILD`, the variable the runbook already uses to
answer *"is the deploy actually the one I think it is"*. A Sentry issue
therefore names a commit that `docker compose exec app printenv APP_BUILD`
agrees with, rather than a version string somebody has to remember to bump.
The web bundle takes the same value through `VITE_APP_BUILD`, which is what
lets one failure be followed across both halves of a request.

## Consequences

**The sluggishness becomes a measurement instead of an impression.** Whether
that 0.7–1.7 s is origin, proxy, or Cloudflare is a question the platform can
now answer rather than argue about.

**A third party receives a bank client's trip data**, by decision. That is the
cost of §2 and it is recorded in three places so that it cannot be discovered
later as a surprise.

**Six `league/commonmark` advisories were cleared on the way**, two of them
rated high — found by `composer audit` running as part of adding the SDK, and
fixed by a patch bump. Unrelated to Sentry and worth more than it cost.

**Two obligations now sit outside this repository**: the processor agreement
and the retention window in Sentry's console. Written into
`data-inventory.md` §8 rather than assumed, because neither will fail a build
if it is forgotten.

## Alternatives considered

**Laravel Telescope or Pulse.** Free, self-hosted, no transfer, no
subscription — genuinely attractive against the cost-discipline north star.
Refused because neither sees the browser or the handset, and the measured
problem is a page load. Telescope is also a debugging tool that stores full
request payloads in the application's own database, which is a larger
personal-data question than the one this ADR answers, not a smaller one.

**Structured logs plus a log aggregator.** The logs already exist and carry
`request_id`, `tenant_id`, `user_id` and `module`. What they do not carry is
timing, browser context, or a stack trace joined across the API and the SPA —
and standing up an aggregator is the self-hosting cost above with less to show
for it.

**Nothing, and profile the slow page directly.** The honest option, and it
would probably find this one defect. It finds the next one only if somebody is
watching at the moment it happens, which for a platform about to carry a
bank's dispatch is not a plan.
