# The API contract

## Purpose

`openapi.yaml` is the **hand-written source of truth** for `/api/v1`
(ADR-0011). The code is checked against it, never the reverse — a generated
spec agrees with the code by construction and can never fail the drift gate
AGENTS.md demands. If this document and the code disagree, the document
wins, and the code (or this PR's deliberate change to the document) is what
moves.

## Responsibilities

- Describe every `api/v1` operation: request, responses, and the error
  envelope with its enumerated `ErrorCode` cases.
- Be the document Phase 2's driver app and Phase 3's employee app are built
  against.

## How it is enforced (three gates, all in the backend CI job)

1. **Response validation** — `backend/tests/Support/ValidatesOpenApiContract.php`,
   registered in `tests/Pest.php`, validates every JSON response the whole
   suite provokes from `/api/v1` against this file. The existing feature
   tests *are* the contract tests; there is no second suite.
2. **Route census** — `backend/tests/Feature/Ci/OpenApiRouteCensusTest.php`
   reconciles method+path both ways: an endpoint may be untested, it may
   not be undocumented — and this file may not promise an endpoint that
   does not exist.
3. **Spec lint** — `backend/tests/Feature/Ci/OpenApiSpecLintTest.php`:
   every object schema must declare `additionalProperties` (that clause is
   what makes gate 1 mean anything), and the `ErrorCode` enum here must
   equal `App\Enums\ErrorCode` exactly.

## Editing rules

- A new or changed endpoint's spec entry ships **in the same PR**
  (AGENTS.md, Definition of Done). The census fails the build otherwise.
- `additionalProperties: false` on every fixed shape; an explicit value
  schema only for genuine maps (validation errors, audit diffs,
  notification context). Never omit it.
- Never remove or repurpose an `ErrorCode` case or a served field —
  AGENTS.md allows additive change only within v1.
- Dialect constraints proved against the installed validator (osteel
  0.14 / league 0.22) are in the header comment of `openapi.yaml`: `anyOf`
  for PHP's empty-map-as-`[]`, `enum: [null]` rather than a bare
  `type: 'null'`, explicit no-content 204s, and nullability via
  `type: [x, 'null']`.

## Dependencies

`osteel/openapi-httpfoundation-testing` (dev). Added with
`composer require --dev -W`: `league/openapi-psr7-validator` needs
`webmozart/assert ^1.4`, which downgrades that package from 2.4.1 to
1.12.1 — verified safe, the only other dependent is
`phpdocumentor/reflection-docblock` with a `^1.9.1 || ^2` constraint.

## What's explicitly deferred (ADR-0011 Scope)

- **Request validation** — the 35 Form Requests stay the enforcement point
  for input; turning both directions on at once makes a red suite hard to
  attribute. Revisit once responses have been stable a while.
- **Publishing** (Redoc/Swagger UI) — the document is a contract before it
  is documentation.
- **Client generation** — TypeScript types from this spec would fix the
  frontend `Trip`-type drift class for good, but changes how the frontend
  is written; its own decision.
- **Contract tests against a running server** (Dredd/Schemathesis) — gate 1
  gets the same coverage from the suite that exists.
- **Response validation of binaries** — the export download and odometer
  photos are declared, not validated; bytes prove nothing.
- **Validating framework-rendered failures** — 405/429/5xx are skipped by
  gate 1: under the test suite's `APP_DEBUG` they carry a debug body
  production never sends. The 429's production shape is documented here
  but only asserted by eye.
