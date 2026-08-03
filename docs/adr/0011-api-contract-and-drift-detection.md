# ADR-0011: The API Contract Is Hand-Written, and Drift Fails the Build

**Status:** Accepted (3 August 2026)

**Implements:** AGENTS.md API Standards — *"The API is documented with
OpenAPI, verified in CI. Mobile apps are built against this contract; drift
between code and spec fails the build."*

**Depends on:** nothing structurally. It touches ADR-0004, ADR-0006 and
ADR-0007 where a resource's shape varies by actor, and it consumes the
`ErrorCode` enum that AGENTS.md's error envelope already mandates.

## Context

Like ADR-0008, this is not a gap somebody wants closed — it is a rule the
project wrote for itself and then did not keep. The sentence in AGENTS.md
makes three claims, and on 3 August 2026, verified by running rather than
by reading, none of the three is true:

- **"documented with OpenAPI"** — there is no `openapi.yaml`, no
  `swagger.json`, and no dependency anywhere in `composer.json` or
  `package.json` that could produce one. Not on `main`, and not on any of
  the four queued branches.
- **"verified in CI"** — `.github/workflows/ci.yml` has four jobs:
  `commits`, `secrets`, `backend` and `frontend`. There is no contract job
  and nothing for one to run.
- **"drift between code and spec fails the build"** — there is no spec, so
  there is nothing to drift from.

AGENTS.md is blunt about what that means: *"A standard that is not enforced
by tooling is a suggestion."* By its own test, this one is a suggestion.

### What the API currently is

- **68 registered `api/v1` routes** on `main` when this was written. The
  queued branches added six more — five for allocations (ADR-0009) and
  `DELETE /auth/mfa` (ADR-0010) — and ADR-0012's walk-in order requests
  another four, all landed during implementation: **78 operations**. The
  growth itself vindicated the census, which went red naming each batch of
  new routes the moment they registered.
- **35 Form Requests** and **18 API Resources**, plus a **24-case
  `ErrorCode` enum**.
- **471 HTTP round-trips** across 48 of the 53 files in
  `backend/tests/Feature`. That number is the one that decides the shape of
  this ADR, and it is easy to get wrong: counting `$this->postJson(` and
  friends gives 58, because most calls chain off `actingAs()` and never
  name `$this` at all.

So the platform already exercises its own API 471 times per suite run, and
throws away every one of those responses the moment the assertions in the
test body are satisfied. A test that asserts `->assertOk()` and reads three
fields has silently accepted whatever else the response contained.

### Why it matters now rather than later

Phase 2 is a driver mobile application, and Phase 3 a corporate employee
one. Both are built by reading a document and trusting it. A web frontend
in the same repository can be wrong about the API and be corrected by
`tsc` within the hour; a shipped mobile binary cannot. The contract's value
is almost entirely in the period before those clients exist, because that
is when it is cheap to be right.

There is also a live example of exactly the failure this is meant to catch.
`TripResource` returns `booking_id`, `odometer_start_photo_url` and
`odometer_end_photo_url`; the frontend's `Trip` type declares none of the
three. That is the same class of defect as the `role_label` bug fixed on
`feat/shell-theme-and-user-menu` — a response and its declared shape
disagreeing, with nothing in the build that could notice.

### The constraint that decides everything else

AGENTS.md does not ask for documentation. It asks for a **gate**: *drift
between code and spec fails the build*.

A **generated** spec cannot drift. It is derived from the code, so it
agrees with the code by construction, on every commit, including the
commits where the code is wrong. Point a drift gate at a generated document
and the gate can never fire — not rarely, never. It would be a CI job whose
only possible outcome is green, which is worse than no job at all, because
a green check reads as a verified contract.

That single constraint eliminates the two cheap options before they are
compared on any other axis:

- **`dedoc/scramble`** infers the spec from controllers, Form Requests and
  Resources. Whatever it infers *is* the code, so it can only ever confirm
  the code.
- **`zircote/swagger-php`** annotations are hand-written, which sounds like
  it escapes the problem, but they live in a docblock directly above the
  method they describe and are edited in the same motion as the code
  beneath them. Drift there is silent by design. They also put several
  hundred lines of docblock into controllers that AGENTS.md wants at 20–60
  lines per method.

A spec is only a contract if it can be wrong about the code. Independence
is the whole mechanism.

## Decision

**The OpenAPI document is hand-written, committed, and is the source of
truth. The code is checked against it, never the reverse.**

### 1. `docs/api/openapi.yaml`, OpenAPI 3.1, reviewed like code

One document, versioned in the repository, read in PRs the way a migration
is read. A new endpoint's spec entry ships in the PR that adds the
endpoint; a changed response shape is a spec diff a reviewer can see. Added
to the Definition of Done, next to "API docs updated" — which until now had
no artefact it could refer to.

Writing it by hand is the cost, and it is the point. Somebody has to decide
what the contract *says*, which is a different activity from recording what
the code currently *does*.

### 2. Responses are validated inside the existing Pest suite

A bootstrap hook in `backend/tests/Pest.php` validates every JSON response
the suite produces against the spec, using
`osteel/openapi-httpfoundation-testing`.

This is the load-bearing choice. It turns the 471 round-trips the suite
already performs into 471 contract assertions, at the cost of a hook — no
second suite, no duplicated fixtures, no separate authentication dance, and
no set of endpoints that are contract-tested only because somebody
remembered to add them twice.

It also puts the signal in the right place. A contract job that runs
separately reports "the API does not match the spec" against the repository;
a hook inside the suite reports it against the test that provoked it, on the
branch that caused it, in the same run that would have gone green.

### 3. A route census asserts every route is documented

`backend/tests/Feature/Ci/` gains a test that reads `route:list` and
asserts every `api/v1/*` method-and-path pair has a matching entry in the
spec.

Response validation alone would leave a hole exactly the size of the
untested endpoints: an endpoint no test exercises produces no response to
validate, so it passes by silence, and the more obscure an endpoint is the
more likely it is to fall in the hole. The census closes it with a rule
that is easy to state and easy to defend: **an endpoint may be untested; it
may not be undocumented.**

The census must compare **method and path**, not path alone, and it must
normalise Laravel's route table before comparing. Three routes are
currently registered `PUT|PATCH` — `companies`, `drivers` and `vehicles`,
from `apiResource`'s default — while AGENTS.md's RESTful naming section
commits only to `PATCH`. The census forces that into the open rather than
leaving it as an accident of a helper, and it is the first thing this gate
will find.

### 4. Every object schema sets `additionalProperties: false`

Without it, a response may carry any number of undeclared fields and still
validate. That is precisely the `role_label` / `TripResource` failure mode:
the spec would describe what the frontend expects, the response would carry
three extra fields, and the validator would shrug.

`additionalProperties: false` is what makes decision 2 mean anything, and
it is the single easiest line in the document to forget. So it gets its own
check: a **spec lint** asserting that every object schema declares it,
failing the build on any that does not. A guarantee this important is not
left to reviewer attention.

### 5. One error schema, with the `ErrorCode` enum enumerated in it

The 24 `ErrorCode` cases become the `enum` of a single reusable `code`
property in one error response schema, referenced by every failure response
in the document. AGENTS.md already requires clients to branch on `code` and
never on message text; enumerating the codes in the contract is what makes
that instruction actionable rather than aspirational.

`message` stays a free string. It is written for a human and is expected to
change.

### 6. Binary responses are declared, not validated

`GET /reports/exports/{export}/download` and
`GET /trips/{trip}/odometer-photo/{moment}` return files. They are declared
in the spec with their content types, and skipped by the response
validator. Asserting on a PDF's bytes proves nothing, and a validator that
tries will fail for reasons unrelated to the contract.

## Feasibility

This was proved by running, in a scratchpad, without touching the
repository:

- **`osteel/openapi-httpfoundation-testing` v0.14**, wrapping
  `league/openapi-psr7-validator` 0.22. Chosen over the validator directly
  because Laravel's `TestResponse` is a Symfony response, not PSR-7, and
  the wrapper is the bridge.
- **It resolves alongside Laravel 12** with `platform.php` pinned to
  8.4.0: `laravel/framework` stays at v12.64.0 and
  `symfony/http-foundation` stays on the 7.4 line (v7.4.14 → v7.4.15, a
  patch). **No Symfony 8 upgrade is forced** —
  `symfony/psr-http-message-bridge` v8.0.8 is versioned independently of
  the Symfony components.
- **It requires `composer require -W`.** A plain `require` fails:
  `league/openapi-psr7-validator` 0.22 needs `webmozart/assert` `^1.4`
  while the project locks 2.4.1, so adding it **downgrades**
  `webmozart/assert` to 1.12.1. Verified safe — the only other dependent is
  `phpdocumentor/reflection-docblock` 6.0.3, whose constraint is
  `^1.9.1 || ^2`. This belongs in the PR description, not in a lock-file
  diff nobody reads.
- **It catches the bug we already have.** A spec omitting `booking_id`,
  `odometer_start_photo_url` and `odometer_end_photo_url` — i.e. matching
  the frontend's `Trip` type — validated against the real `TripResource`
  shape produces:

  ```
  ValidationException: Keyword validation failed: Data has additional
  properties (booking_id,odometer_start_photo_url,odometer_end_photo_url)
  which are not allowed   Field: data
  ```

  The same response against a spec declaring all three **passed**. It fails
  on drift and does not false-positive on conformance, which is the only
  pair of properties that matters.
- **Cost:** the validator builds once in 31.6 ms; 471 validations took
  565.9 ms, 1.20 ms each — about 0.6 s on a suite that runs in ~100 s.

## Consequences

**Writing an endpoint becomes a two-file job.** This is the intended cost
and the main one. It is paid per endpoint, by the person who best knows
what the endpoint promises, at the moment they know it.

**The suite gains a failure mode that is not about the test.** A test
asserting nothing about a field will now fail because a *different* field
appeared. That is the feature, but it will be surprising the first time,
and the hook's failure message must say plainly that the response did not
match `docs/api/openapi.yaml` and which property was at fault — AGENTS.md's
error-message standard applies to the tools as much as to the API.

**The census found the `PUT|PATCH` routes immediately**, as predicted:
`companies`, `drivers` and `vehicles` registered update as `PUT|PATCH` from
`apiResource`'s default while AGENTS.md's RESTful naming commits only to
`PATCH`. Settled by dropping `PUT` — verified first that the only `PUT`
caller anywhere (tests and frontend) is `rate-cards/{id}/default`, which
stays `PUT` deliberately. Removing a verb is a breaking change once clients
exist; nothing outside this repository consumes the API yet, which made
this the only cheap moment.

**Resources that branch on permission described cleanly — the feared
`oneOf` sprawl never materialised.** ADR-0006/0007's actor-dependent fields
are all `whenLoaded`/`when` conditionals, which map to *optional* (not
variant) properties: present-and-typed or absent, which
`additionalProperties: false` handles without any union. The only unions
the document needed are for PHP serialising an empty map as `[]` — and
those must be `anyOf`, not `oneOf`, because an empty value matches both
branches and `oneOf` rejects exactly-one. The dialect facts proved against
the installed validator (that, plus `enum: [null]` over a bare
`type: 'null'`, plus explicit no-content 204s) are recorded in the spec's
header comment.

**Measured cost, replacing the one-path inference:** the full suite runs
**525 tests in ~107 s** against a ~100 s baseline — the validation itself
is the predicted ~1 ms per response; the rest is parsing the 78-operation
document, which must be built exactly once per process. The first
implementation memoised the validator on the trait, which under Pest is
one static *per test-file class* — it parsed the spec ~50 times, pinned
every copy, and exhausted the 128 MB limit mid-suite. The memo lives in a
dedicated holder class for that reason.

**PHP 8.4 at runtime is still unverified.** Only dependency *resolution*
was proved under a simulated 8.4 platform; the probe ran on local 8.3.32,
and there is no 8.4 binary on this machine. Deprecation notices from the
new packages under 8.4 are unknown until CI runs. PHPStan at
`phpVersion: 80400` is currently clean on `main` and on both feature
branches, and a tokenizer scan found zero implicitly nullable parameters
across `database`, `tests`, `routes`, `config` and `bootstrap`. That is the
baseline to keep.

**The spec becomes reviewable, and therefore arguable.** A hand-written
contract can be wrong in a way a generated one cannot, and reviewers will
occasionally have to decide whether the spec or the code is the mistake.
That question having an answer — the spec is the source of truth, so the
code is what changes — is the reason for doing it this way.

## Scope

**In:** `docs/api/openapi.yaml` covering all 78 `api/v1` operations; the
error schema and its enumerated codes; the Pest hook
(`tests/Support/ValidatesOpenApiContract.php`, registered in `Pest.php`);
the route census test; the `additionalProperties` spec lint and the
ErrorCode-enum lint (both in `tests/Feature/Ci/`, so the existing backend
CI job runs them); the `composer require --dev -W` dependency addition; and
the AGENTS.md Definition of Done amendment that makes a spec entry part of
a PR.

**Out, deliberately:**

- **Request validation.** The library can validate requests too. It is not
  turned on in this pass: the 35 Form Requests are the enforcement point
  for input, request bodies in tests are frequently minimal by intent, and
  turning both directions on at once makes a red suite hard to attribute.
  Revisit once responses are green and stable.
- **Publishing the spec.** No Redoc or Swagger UI page, no hosted
  reference, no CI artefact. The document is a contract before it is
  documentation; rendering it is presentation work that changes nothing
  about correctness.
- **Client generation.** No generated TypeScript types for the frontend,
  even though the spec makes it possible and `TripResource` is the standing
  argument for it. Generating the frontend's types from the contract is a
  genuinely good idea and a separate decision, with its own effect on how
  the frontend is written.
- **Contract tests against a running server.** Dredd, Schemathesis and
  friends need a deployed instance and a fixture strategy the suite already
  has. Decision 2 gets the same coverage from the tests that exist.
- **Versioning the document itself.** One file for v1. If `/api/v2` ever
  exists, how two specs coexist is that ADR's problem.

## Alternatives considered

**Generate the spec from the code (`dedoc/scramble`).** By far the cheapest
— a dependency, a config file, and 68 endpoints documented in an afternoon,
kept current for free. Rejected because it cannot satisfy the requirement
it appears to satisfy. A derived document agrees with its source by
construction, so the drift gate AGENTS.md asks for could never fail, and CI
would carry a permanently green check that no one could distinguish from a
verified contract. Cheap documentation is a real thing worth having; it is
not what the standard asks for.

**Annotate the controllers (`zircote/swagger-php`).** Hand-written, so in
principle capable of disagreeing with the code. Rejected on two counts: the
annotation sits in the docblock of the method it describes and is revised
in the same edit, so it drifts silently and the gate degrades into a
formatting check; and several hundred lines of docblock in controllers is
directly against AGENTS.md's 20–60-line target for controller methods.

**Generate the spec, commit the output, and fail CI if regeneration
differs.** The interesting near-miss, and the one worth naming because it
looks like it solves the problem. It does detect *something*: that the code
changed without the committed snapshot being refreshed. But what it
verifies is that the snapshot is stale, not that the code is wrong — the
snapshot's contents still come from the code, so the fix for every failure
is to accept the new output. It is a gate whose only remedy is to agree
with whatever the code now says. That is a changelog, not a contract.

**A separate contract-test suite.** Cleaner separation: contract concerns
in their own files, no effect on the existing suite. Rejected on
duplication and on coverage. It would re-establish authentication, tenancy
and fixtures that `backend/tests/Feature` already builds, and would cover
only the endpoints somebody remembered to write twice — while the 471
round-trips that already exist continued to check nothing. The hook gets
strictly more coverage for strictly less code.

**Consumer-driven contract testing (Pact).** The right tool once a driver
app and a web app are independently evolving consumers of the same API.
Rejected for now: there is one consumer, in this repository, and a
provider-side spec is what the second and third consumers will be built
from. Pact answers "does the provider satisfy its consumers"; the question
today is "is there a written contract at all".

**Do nothing until the mobile app is being built.** Defensible on
sequencing — the contract's consumers do not exist yet. Rejected because
the cost curve runs the wrong way. Documenting 74 endpoints against a
suite that already exercises them is a bounded pass now; documenting 150
endpoints while a mobile team waits, and discovering the disagreements
then, is not. And the `TripResource` drift shows the defect this prevents
is already present, not hypothetical.
