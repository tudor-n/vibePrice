# ADR 0002: Shared PostgreSQL + jobs table; no message queue in v1

**Status:** Accepted · 2026-07-04

## Context

Backend and dataplane must exchange data (scraped rates, recommendations) and dispatch
work (dashboard "refresh now"). Options: REST calls between them, a message queue
(RabbitMQ/Redis), or a shared database.

## Decision

Both runtimes share one PostgreSQL database. Table write-ownership is contractual
(`shared/contracts/table-ownership.md`). Dispatch uses a `jobs` table with atomic claiming
(`UPDATE ... WHERE status='queued' ... RETURNING`). The backend owns all schema via EF Core
migrations; Python maps tables read-only-DDL (SQLAlchemy models, no DDL emission).

## Consequences

- (+) One infrastructure component; observable dispatch (jobs visible on the dashboard);
  atomic claim already supports multiple workers.
- (−) Schema coupling: every shared-table change touches EF and SQLAlchemy in one PR.
- Polling latency (seconds) is acceptable for v1; a queue can replace the polling loop
  later without changing any contract.
