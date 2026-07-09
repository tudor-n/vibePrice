# PricePilot — agent guide

Dynamic pricing SaaS for hotels/guesthouses: scrape competitor rates + ingest public
demand data → explainable price recommendations on a multi-tenant dashboard.
Approved design spec: `docs/superpowers/specs/2026-07-04-pricepilot-design.md`.

## Architecture map (read this first)

Three deployable units meet at PostgreSQL. **They never call each other directly.**

| Area | Stack | Owns | Guide |
|---|---|---|---|
| `backend/` | ASP.NET Core 9, EF Core | API, auth, tenants, **DB schema (all migrations)** | `backend/CLAUDE.md` |
| `dataplane/` | Python 3.12+, SQLAlchemy, APScheduler | scrapers, ingest, pricing engine, scheduler | `dataplane/CLAUDE.md` |
| `web/` | React 19, TypeScript, Vite | dashboard UI | `web/CLAUDE.md` |

Cross-runtime contracts live in `shared/contracts/` — **treat them as law**:
- `table-ownership.md` — who may write each table; schema changes touch both C# and Python in the same PR
- `jobs.md` — the only backend→dataplane dispatch mechanism (jobs table)
- `recommendation-factors.md` — shape of the engine's reasoning JSON
- `openapi.yaml` — API surface; update in the same PR as any endpoint change

## Commands

```bash
docker compose up -d db          # just Postgres (local dev)
docker compose up --build        # full stack: db, api :8080, dataplane, web :5173

cd backend  && dotnet build && dotnet test
cd dataplane && py -m pytest     # (python3 -m pytest on Linux/CI)
cd web      && npm test && npm run build
```

## Working routine (all non-trivial changes)

1. **Brainstorm/design first** for new features — do not jump to code (superpowers:brainstorming).
2. **Plan** multi-step work before touching code (superpowers:writing-plans).
3. **TDD**: failing test → implementation → green (superpowers:test-driven-development).
4. **Code review before merge** — dispatch the `code-reviewer` agent (`.claude/agents/code-reviewer.md`).
5. **Verify before claiming done**: run the affected area's build + tests and show output.
6. Significant architectural decisions get an ADR in `docs/adr/`.

## Definition of done

- [ ] Tests written and passing (`dotnet test` / `pytest` / `npm test` for touched areas)
- [ ] Contract files in `shared/contracts/` updated if any table, job, factors shape, or endpoint changed
- [ ] Schema change? EF migration AND SQLAlchemy model updated together
- [ ] No tenant data leak: every new query on tenant-owned tables is tenant-scoped
- [ ] Code-reviewer agent ran and its findings were addressed

## Hard rules (violations are review-blockers)

1. **Tenant isolation.** Every query on tenant-owned tables filters by tenant. In C#, EF
   global query filters do this — never bypass with `IgnoreQueryFilters()` outside admin code.
   In Python, every session helper takes explicit tenant/property scope where applicable.
2. **Money is `decimal`/`numeric`, never float.** In all three languages. Currency travels
   with every amount.
3. **Prices are the product.** Engine rules are pure functions with unit tests for
   boundaries. A recommendation without a complete `factors` payload is a bug.
4. **Scrapers never run against live sites in tests.** Fixtures only — scraper HTML in
   `dataplane/tests/fixtures/`, places JSON packaged at `dataplane/src/pricepilot/places/fixtures/`
   (shipped in the image; the default fixture provider reads it at runtime).
5. **No cross-runtime calls.** Backend and dataplane communicate via the DB and jobs table only.
6. **12-factor config.** All config from environment variables; secrets never committed.
   `.env.example` documents every variable.
7. **Dates**: stay dates are `date` (no timezone games); instants are UTC `timestamptz`.

## Repo conventions

- Conventional commits: `feat(engine): ...`, `fix(api): ...`, `docs: ...`
- Branch per feature; `main` stays green.
- English for code, comments, docs, and factor `reason` strings (i18n lives in `web/`).
