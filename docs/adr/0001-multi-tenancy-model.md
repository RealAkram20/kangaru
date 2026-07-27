# 0001. Multi-Tenancy Model

**Status:** Accepted

## Context

KangaruRide serves multiple corporate clients (tenants) — banks, NGOs,
government agencies, fleet owners — from a single deployment. We need to
choose how tenant data is isolated, balancing operational simplicity against
the risk of a cross-tenant data leak, which is the single worst bug this
platform can have given its anchor client is a bank.

## Decision

Single database, shared schema, mandatory tenant scoping.

- Every tenant-owned table carries a non-nullable, indexed, foreign-keyed
  `tenant_id`.
- A global Eloquent scope (`BelongsToTenant` trait) applies tenant filtering
  automatically. Opting out is rare and reviewed.
- Raw queries that bypass the scope are forbidden outside repositories and
  must include `tenant_id` manually with a comment explaining why.
- Cache keys are prefixed `tenant:{id}:`. File storage paths are prefixed
  `tenants/{id}/`.

## Consequences

Simple operations and one migration path, right for our scale. A cross-tenant
data leak is the single worst bug this platform can have — mitigated by a
mandatory CI test suite that attempts cross-tenant reads on every API
resource and must fail. If a future client demands physical isolation,
tenant-scoped queries make extraction to a dedicated database possible;
document as escape hatch, do not build now.

## Alternatives considered

- **Database-per-tenant** — operational burden too high at our scale.
- **Schema-per-tenant** — poor MySQL fit.
