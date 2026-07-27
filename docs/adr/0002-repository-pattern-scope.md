# 0002. Repository Pattern Scope

**Status:** Accepted

## Context

The repository pattern adds a layer of indirection between services and
Eloquent. Applied everywhere, it adds boilerplate without benefit for simple
CRUD; applied nowhere, complex or security-sensitive queries become harder to
test and reuse. We need a rule for when a repository earns its cost.

## Decision

Repositories are required only where they earn their cost:

1. Queries used by two or more services.
2. Non-trivial queries (joins, aggregates, geospatial, reporting).
3. Anything touching billing, invoicing, or payments (isolation aids
   auditing and testing).

Simple single-model CRUD inside a service may use Eloquent directly. A
repository that only proxies `find`/`create`/`update`/`delete` with no added
logic must be deleted in review.

## Consequences

Keeps the codebase honest — every repository that exists is doing real work.
Reviewers reject repositories added "just in case." Billing and Dispatch
modules get repositories from day one because they meet criterion 3; most
other modules start without any.

## Alternatives considered

- **Repository for every model** — rejected: boilerplate with no payoff for
  simple CRUD, and it obscures which queries are actually complex enough to
  need review.
- **No repository pattern at all** — rejected: billing/payment queries need
  the isolation for auditing and reliable testing.
