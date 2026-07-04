# ADR 0001: Monorepo with three runtimes (C#, Python, TypeScript)

**Status:** Accepted · 2026-07-04

## Context

The product needs a multi-tenant SaaS API (team's strength: C#), heavy scraping/data/ML
work (Python's ecosystem is strongest), and a web dashboard (React/TS). Alternatives:
all-Python (FastAPI) or all-TypeScript would give one runtime but sacrifice either the
team's C# fluency or Python's data ecosystem.

## Decision

One repository, three deployable units: `backend/` (ASP.NET Core), `dataplane/` (Python),
`web/` (React+TS). Cross-runtime contracts are documented artifacts in `shared/contracts/`
and enforced in code review.

## Consequences

- (+) Each concern uses the best-fit ecosystem; single PR can update a contract atomically.
- (−) Two backend runtimes to deploy and keep contract-aligned; the table-ownership and
  jobs contracts must be kept disciplined (code-reviewer agent checks this).
