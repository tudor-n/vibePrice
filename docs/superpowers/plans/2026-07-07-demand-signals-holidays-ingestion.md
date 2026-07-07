# Demand-Signals Ingestion (Holidays) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `handle_ingest_demand_signals` from a stub into a real, idempotent ingestion that writes Romanian public holidays into the `demand_signals` table for a city — the first working `demand_signals` producer. Pure/self-contained: no external API, no scraping, no schema change, no cross-runtime coordination.

**Architecture:** Mirror the proven `ingest.events` shape exactly. A pure record builder maps `holidays.romanian_public_holidays(year)` → `DemandSignalRecord`s; a generic `upsert_demand_signals()` does a deterministic-`uuid5` `INSERT … ON CONFLICT (id) DO UPDATE` (same idempotency mechanism as `upsert_events`); an orchestration function `ingest_holidays()` wires source → upsert; the `handle_ingest_demand_signals` job handler calls it. The nightly scheduler already enqueues the job — only the handler body changes.

**Tech Stack:** Python 3.12, SQLAlchemy 2.x (`postgresql.insert().on_conflict_do_update`), pytest (unit + `integration` marker via `dbprobe`), ruff. No new dependencies.

**Companion spec:** none written — the design section below is self-contained (the choices here are small and follow an existing, reviewed pattern). Write a spec under `docs/superpowers/specs/` only if review wants the alternatives recorded.

---

## Design & decisions

### What the schema already gives us (verified, no change needed)

`demand_signals` (backend-owned, dataplane-written; C# `DemandSignal.cs` ⇄ SQLAlchemy `tables.py:140`):

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | deterministic `uuid5` of the natural key (idempotency) |
| `city` | `varchar(100)` | lowercase slug (`sibiu`); city-scoped, **not** tenant-scoped |
| `signal_type` | `varchar(100)` | this ingestion writes `"public_holiday"` |
| `signal_date` | `date` | the holiday's date |
| `value` | `numeric(14,4)` | `Decimal("1")` = flag (holiday present); not money, no currency column |
| `source` | `varchar(100)` | `"holidays"` |
| `created_at` | `timestamptz` | server/py default; preserved across upserts |

The table is already in `DATAPLANE_WRITTEN_TABLES` (schema_check) and `table-ownership.md`. **No EF migration, no `table-ownership.md` change, no `recommendation-factors.md` change.**

### Modeling choice: holiday-as-flag row per date

One `demand_signals` row per public-holiday date: `signal_type="public_holiday"`, `value=Decimal("1")`, `source="holidays"`. Rationale: matches the row-per-natural-key convention of `events`/`scraped_rates`; a future engine rule can `WHERE signal_type='public_holiday' AND signal_date=<stay>` for an O(1) lookup. Holidays are national, but stored per `city` because every engine read is city-scoped — we ingest them under the requested city (`payload.city`, default `sibiu`).

### Idempotency: deterministic `uuid5` + `ON CONFLICT (id) DO UPDATE`

Copied verbatim from `ingest/events.py`: `demand_signal_row_id(city, signal_type, signal_date) = uuid5(NAMESPACE, "city|signal_type|isodate")`; conflict target is the PK `id`, so a re-run refreshes `value`/`source` in place and never duplicates. No new unique index required (the PK carries the natural key).

### Year coverage & the 2026-only source

`holidays.romanian_public_holidays(year)` currently supports **only 2026** (raises `NotImplementedError` otherwise — see `ingest/holidays.py`). The handler ingests holidays for the calendar years spanning the recommendation horizon (`today.year` and `today.year + 1`, since the 90-day engine horizon can cross Dec 31), **skipping unsupported years gracefully** (log + continue) so a run near year-end never crashes the worker. When the `holidays` PyPI package lands (existing TODO in `holidays.py`), only the source changes; this ingestion is unaffected.

### Scope boundary (important)

**In scope:** the write path — records → `demand_signals`, wired through the job handler, idempotent, tested. **Explicitly out of scope:** the engine *consuming* the signal. `_load_rule_contexts` never populates `RuleContext.avg_occupancy_by_month` and no rule reads holidays today, so ingesting holidays does **not** change any recommendation yet. That is an honest, separate follow-up (see "Follow-ups").

### Approaches considered

1. **Holidays first (chosen)** — fully local/deterministic, zero external deps, mirrors `ingest.events`, exercises the new schema-sync/CI harness, ships value with no live-site risk.
2. INS tourism stats first — feeds `avg_occupancy_by_month` which `seasonality` already reads, so it would move prices immediately. Rejected as *first*: needs the INS Tempo HTTP API (`tourism_stats.py` is a `NotImplementedError` stub) → external, flaky, human-in-the-loop; better once the write/consume plumbing exists.
3. Weather first — same external-API objection (`weather.py` stub, open-meteo).

---

## Global constraints

- `tables.py` never emits DDL; the database is ground truth. This plan adds **no** schema change — if the schema-sync check ever complains, the mapping is wrong, not the DB.
- Money stays `Decimal`/`numeric`; `demand_signals.value` is `Decimal` (a flag `1`, not money — no currency). Stay/signal dates are `date`; instants are UTC `timestamptz` (`*_at`).
- Dataplane must pass `ruff check src tests`. Pure ingest functions do no I/O, no clocks inside the record builders (pass `year`/`today` in) — keeps them unit-testable and deterministic.
- Idempotent writes: deterministic `uuid5` id + `ON CONFLICT (id) DO UPDATE` (the repo rule). Re-running a succeeded job is always safe.
- Dev DB: `postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot` (docker compose `db`, migrated by backend EF tooling).
- Commands on this machine (Windows PowerShell): dataplane `.venv\Scripts\python -m pytest`; integration needs `$env:DATABASE_URL` set and (in CI) `PRICEPILOT_REQUIRE_DB=1`.
- Conventional commits; commit after each task.

---

### Task 1: `ingest/demand_signals.py` — record + idempotent upsert (TDD, id derivation no DB)

**Files:**
- Create: `dataplane/src/pricepilot/ingest/demand_signals.py`
- Create: `dataplane/tests/test_ingest_demand_signals.py`

**Interfaces (produced, consumed by Tasks 2–4):**
- `@dataclass(frozen=True) DemandSignalRecord(city, signal_type, signal_date, value)`
- `demand_signal_row_id(city, signal_type, signal_date) -> UUID`
- `upsert_demand_signals(session, records, *, source) -> int` (does not commit — caller owns the transaction)

- [ ] **Step 1: Write the failing unit tests** (mirror `tests/test_ingest_events.py`)

```python
"""Unit tests (no DB) for the demand_signals upsert natural-key derivation."""

from datetime import date
from decimal import Decimal

from pricepilot.ingest.demand_signals import DemandSignalRecord, demand_signal_row_id


def test_row_id_is_deterministic() -> None:
    a = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    b = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert a == b


def test_row_id_varies_with_each_natural_key_part() -> None:
    base = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert base != demand_signal_row_id("cluj", "public_holiday", date(2026, 12, 1))  # city
    assert base != demand_signal_row_id("sibiu", "weather", date(2026, 12, 1))  # signal_type
    assert base != demand_signal_row_id("sibiu", "public_holiday", date(2027, 12, 1))  # date


def test_record_holds_decimal_value() -> None:
    rec = DemandSignalRecord("sibiu", "public_holiday", date(2026, 12, 1), Decimal("1"))
    assert isinstance(rec.value, Decimal)
```

- [ ] **Step 2: Run to verify failure** — `.venv\Scripts\python -m pytest tests/test_ingest_demand_signals.py -q`
  Expected: `ModuleNotFoundError: No module named 'pricepilot.ingest.demand_signals'`.

- [ ] **Step 3: Implement `ingest/demand_signals.py`** (structure copied from `ingest/events.py`)

```python
"""Demand-signals ingestion: city-scoped public-stats time series.

Persistence mirrors ``ingest.events``: every row id is the deterministic uuid5
of its natural key ``(city, signal_type, signal_date)`` and writes go through a
PostgreSQL ``INSERT ... ON CONFLICT (id) DO UPDATE``, so re-ingesting the same
series refreshes ``value``/``source`` in place and never duplicates rows.

Maps the backend-owned ``demand_signals`` table (``shared/contracts/
table-ownership.md``); never emits DDL. ``value`` is ``numeric(14,4)`` and is
NOT money (no currency) — e.g. a ``public_holiday`` flag is ``Decimal("1")``.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal

#: Namespace for deterministic demand_signals ids (uuid5 of the natural key).
DEMAND_SIGNALS_UUID_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://pricepilot.dev/demand-signals"
)


@dataclass(frozen=True)
class DemandSignalRecord:
    """One city-scoped signal point (value is Decimal, not money)."""

    city: str
    signal_type: str
    signal_date: date
    value: Decimal


def demand_signal_row_id(city: str, signal_type: str, signal_date: date) -> UUID:
    """Deterministic demand_signals.id from (city, signal_type, signal_date)."""
    return uuid.uuid5(
        DEMAND_SIGNALS_UUID_NAMESPACE,
        f"{city}|{signal_type}|{signal_date.isoformat()}",
    )


def upsert_demand_signals(
    session: Session, records: Sequence[DemandSignalRecord], *, source: str
) -> int:
    """Idempotently upsert signal records; returns the number of rows written.

    Conflict target is the deterministic id (uuid5 of the natural key), so a
    re-run updates ``value``/``source`` in place. ``created_at`` is kept from
    the first insert. Does not commit — the caller owns the transaction.
    """
    if not records:
        return 0
    rows = [
        {
            "id": demand_signal_row_id(r.city, r.signal_type, r.signal_date),
            "city": r.city,
            "signal_type": r.signal_type,
            "signal_date": r.signal_date,
            "value": r.value,
            "source": source,
        }
        for r in records
    ]
    stmt = pg_insert(DemandSignal).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[DemandSignal.id],
        set_={"value": stmt.excluded.value, "source": stmt.excluded.source},
    )
    session.execute(stmt)
    return len(rows)
```

- [ ] **Step 4: Run unit tests + lint** — `.venv\Scripts\python -m pytest tests/test_ingest_demand_signals.py -q` (expect pass) then `.venv\Scripts\python -m ruff check src tests` (expect clean).

- [ ] **Step 5: Commit**

```bash
git add dataplane/src/pricepilot/ingest/demand_signals.py dataplane/tests/test_ingest_demand_signals.py
git commit -m "feat(dataplane): demand_signals record + idempotent uuid5 upsert"
```

---

### Task 2: Holidays → signal records (TDD, no DB)

**Files:**
- Modify: `dataplane/src/pricepilot/ingest/holidays.py`
- Modify: `dataplane/tests/test_ingest_demand_signals.py` (append)

**Interfaces:**
- `HOLIDAY_SIGNAL_TYPE = "public_holiday"`, `HOLIDAYS_SOURCE = "holidays"`
- `holiday_signal_records(city, year) -> list[DemandSignalRecord]` (raises for an unsupported year, delegating to the existing source guard)
- `supported_holiday_records(city, years) -> list[DemandSignalRecord]` (skips unsupported years, returns what it can)

- [ ] **Step 1: Write failing tests** (append to `test_ingest_demand_signals.py`)

```python
from decimal import Decimal

from pricepilot.ingest.holidays import (
    HOLIDAY_SIGNAL_TYPE,
    holiday_signal_records,
    romanian_public_holidays,
    supported_holiday_records,
)


def test_holiday_records_cover_every_2026_holiday_as_a_flag() -> None:
    recs = holiday_signal_records("sibiu", 2026)
    holidays = romanian_public_holidays(2026)
    assert len(recs) == len(holidays)
    assert {r.signal_date for r in recs} == set(holidays)
    assert all(r.signal_type == HOLIDAY_SIGNAL_TYPE for r in recs)
    assert all(r.city == "sibiu" for r in recs)
    assert all(r.value == Decimal("1") for r in recs)


def test_supported_holiday_records_skips_unsupported_years() -> None:
    # 2026 supported, 2099 not — result is exactly the 2026 set, no crash.
    recs = supported_holiday_records("sibiu", [2026, 2099])
    assert len(recs) == len(romanian_public_holidays(2026))
    assert {r.signal_date.year for r in recs} == {2026}
```

- [ ] **Step 2: Run to verify failure** — `ImportError` for the new names.

- [ ] **Step 3: Implement in `holidays.py`** (append; keep the existing `_HOLIDAYS_2026` / `romanian_public_holidays`)

```python
import logging
from decimal import Decimal

from pricepilot.ingest.demand_signals import DemandSignalRecord

logger = logging.getLogger(__name__)

HOLIDAY_SIGNAL_TYPE = "public_holiday"
HOLIDAYS_SOURCE = "holidays"
_HOLIDAY_VALUE = Decimal("1")  # presence flag (numeric(14,4))


def holiday_signal_records(city: str, year: int) -> list[DemandSignalRecord]:
    """Public holidays of ``year`` as city-scoped demand-signal flags.

    Raises ``NotImplementedError`` for a year the source cannot supply — callers
    that span multiple years should use :func:`supported_holiday_records`.
    """
    return [
        DemandSignalRecord(
            city=city,
            signal_type=HOLIDAY_SIGNAL_TYPE,
            signal_date=holiday,
            value=_HOLIDAY_VALUE,
        )
        for holiday in romanian_public_holidays(year)
    ]


def supported_holiday_records(city: str, years: list[int]) -> list[DemandSignalRecord]:
    """Holiday flags for every supported year in ``years`` (unsupported skipped)."""
    records: list[DemandSignalRecord] = []
    for year in years:
        try:
            records.extend(holiday_signal_records(city, year))
        except NotImplementedError:
            logger.warning("Skipping holidays for unsupported year %d (source TODO)", year)
    return records
```

> Note: `holidays.py` importing from `demand_signals.py` is acyclic (`demand_signals.py` imports only `db.tables`). Keep it that way.

- [ ] **Step 4: Run tests + lint** — expect pass + `ruff` clean.

- [ ] **Step 5: Commit**

```bash
git add dataplane/src/pricepilot/ingest/holidays.py dataplane/tests/test_ingest_demand_signals.py
git commit -m "feat(dataplane): map Romanian public holidays to demand-signal flags"
```

---

### Task 3: `ingest_holidays` orchestration + integration idempotency test (DB)

**Files:**
- Modify: `dataplane/src/pricepilot/ingest/holidays.py` (add orchestration entry point)
- Create: `dataplane/tests/integration/test_ingest_demand_signals.py`

**Interfaces:**
- `ingest_holidays(session, *, city, today=None) -> int` — computes the years spanning `[today, today+~90d]`, calls `supported_holiday_records`, upserts, returns rows written.
- Consumes `DATABASE_URL`, `integration_marks` from `tests/integration/dbprobe.py`.

- [ ] **Step 1: Add `ingest_holidays` to `holidays.py`**

```python
from datetime import date, timedelta

from pricepilot.db.session import Session  # type: ignore[attr-defined]  # if not exported, import Session from sqlalchemy.orm
from pricepilot.ingest.demand_signals import upsert_demand_signals

#: Days ahead we guarantee holiday coverage for (>= engine horizon of 90).
HOLIDAY_HORIZON_DAYS = 400


def ingest_holidays(session: Session, *, city: str, today: date | None = None) -> int:
    """Upsert public-holiday flags for ``city`` across the coverage horizon.

    Covers every calendar year touched by ``[today, today + HOLIDAY_HORIZON_DAYS]``
    so a 90-day recommendation window that crosses Dec 31 still has coverage.
    Unsupported years are skipped (logged). Idempotent; does not commit.
    """
    today = today or date.today()
    end = today + timedelta(days=HOLIDAY_HORIZON_DAYS)
    years = list(range(today.year, end.year + 1))
    records = supported_holiday_records(city, years)
    return upsert_demand_signals(session, records, source=HOLIDAYS_SOURCE)
```

> Import note: use `from sqlalchemy.orm import Session` for the type (match the style already used in `ingest/events.py` — it imports `Session` from `sqlalchemy.orm`). Remove the placeholder import comment above.

- [ ] **Step 2: Write the integration test** (mirror `tests/integration/test_engine_e2e.py` header/probe usage)

```python
"""Integration: holidays ingestion writes idempotent demand_signals rows.

Runs against the EF-migrated dev/CI database. demand_signals has no FKs, so this
needs no backend demo seed — only the migrated schema.
"""

from datetime import date

from dbprobe import DATABASE_URL, integration_marks
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal
from pricepilot.ingest.holidays import (
    HOLIDAY_SIGNAL_TYPE,
    ingest_holidays,
    romanian_public_holidays,
)

pytestmark = integration_marks()

_TEST_CITY = "sibiu"


def _session() -> Session:
    return Session(create_engine(DATABASE_URL))


def _holiday_count(session: Session, year: int) -> int:
    return session.execute(
        select(func.count()).where(
            DemandSignal.city == _TEST_CITY,
            DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            func.extract("year", DemandSignal.signal_date) == year,
        )
    ).scalar_one()


def test_ingest_holidays_is_idempotent() -> None:
    session = _session()
    try:
        # Isolate from any prior run of this test.
        session.execute(
            delete(DemandSignal).where(
                DemandSignal.city == _TEST_CITY,
                DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            )
        )
        session.commit()

        expected_2026 = len(romanian_public_holidays(2026))
        today = date(2026, 1, 15)

        first = ingest_holidays(session, city=_TEST_CITY, today=today)
        session.commit()
        second = ingest_holidays(session, city=_TEST_CITY, today=today)
        session.commit()

        assert first == second  # same rows both runs
        assert _holiday_count(session, 2026) == expected_2026  # upsert: no duplicates

        row = session.execute(
            select(DemandSignal).where(
                DemandSignal.city == _TEST_CITY,
                DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            ).limit(1)
        ).scalar_one()
        assert str(row.value) in ("1", "1.0000")  # numeric(14,4) flag
        assert row.source == "holidays"
    finally:
        session.close()
```

- [ ] **Step 3: Run with the DB up**

```powershell
$env:DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
.venv\Scripts\python -m pytest tests/integration/test_ingest_demand_signals.py -q
```
Expected: pass (holidays for 2026 written once; second run upserts, count unchanged). If it skips, the dev DB isn't migrated — apply backend EF migrations (see `dataplane/CLAUDE.md`).

- [ ] **Step 4: Lint + commit**

```bash
git add dataplane/src/pricepilot/ingest/holidays.py dataplane/tests/integration/test_ingest_demand_signals.py
git commit -m "feat(dataplane): ingest_holidays orchestration + idempotency integration test"
```

---

### Task 4: Wire `handle_ingest_demand_signals` + handler integration test

**Files:**
- Modify: `dataplane/src/pricepilot/scheduler/jobs.py` (replace the stub body of `handle_ingest_demand_signals`, L127–132)
- Modify: `dataplane/tests/integration/test_ingest_demand_signals.py` (append handler test)

**Interfaces:** none new. Scheduler dispatch (`main.py:62`, `HANDLERS`) already routes `ingest.demand_signals`.

- [ ] **Step 1: Replace the stub** (keep signature and the contract's return-shape convention — `{"city": ..., "signals_written": N}`, matching `handle_ingest_events`)

```python
def handle_ingest_demand_signals(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Refresh public demand signals for a city.

    v1 source: Romanian public holidays as ``public_holiday`` flags in
    ``demand_signals`` (idempotent uuid5 upsert). Tourism stats / weather
    remain TODO (``ingest.tourism_stats`` / ``ingest.weather`` — external APIs).
    """
    city = (payload.get("city") or "sibiu").lower()
    written = ingest_holidays(session, city=city)
    logger.info("ingest.demand_signals: city=%s signals_written=%d", city, written)
    return {"city": city, "signals_written": written}
```

Add the import at the top of `jobs.py` (next to the existing `from pricepilot.ingest.events import ...`):

```python
from pricepilot.ingest.holidays import ingest_holidays
```

- [ ] **Step 2: Append the handler integration test** (mirror how `test_engine_e2e.py` drives a job via `enqueue_job` + `poll_once`, or call the handler directly)

```python
def test_handler_writes_holiday_signals() -> None:
    session = _session()
    try:
        session.execute(
            delete(DemandSignal).where(
                DemandSignal.city == _TEST_CITY,
                DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            )
        )
        session.commit()

        from pricepilot.scheduler.jobs import handle_ingest_demand_signals

        result = handle_ingest_demand_signals(session, {"city": "SIBIU"})  # case-normalized
        session.commit()

        assert result["city"] == "sibiu"
        assert result["signals_written"] >= len(romanian_public_holidays(2026))
    finally:
        session.close()
```

- [ ] **Step 3: Full dataplane suite green (DB up)**

```powershell
$env:DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
.venv\Scripts\python -m pytest -q
```
Expected: previous count + the new unit/integration tests, all passing; schema-sync test still green (no schema change). Then `.venv\Scripts\python -m ruff check src tests` clean.

- [ ] **Step 4: Manual end-to-end check via the real dispatch path** (proves the wired job, mirrors `docs/demo.md` step 3)

```powershell
.venv\Scripts\python -c "from pricepilot.db.session import get_session_factory; from pricepilot.scheduler.jobs import enqueue_job; from pricepilot.scheduler.main import poll_once; s=get_session_factory()(); enqueue_job(s,'ingest.demand_signals',{'city':'sibiu'}); s.close(); print('handled:', poll_once())"
```
Expected: `handled: True`, and a job row with `status='succeeded'`, `result={"city":"sibiu","signals_written":16}` (16 = the 2026 holiday count). Verify: `SELECT count(*) FROM demand_signals WHERE signal_type='public_holiday';` → 16.

- [ ] **Step 5: Commit**

```bash
git add dataplane/src/pricepilot/scheduler/jobs.py dataplane/tests/integration/test_ingest_demand_signals.py
git commit -m "feat(dataplane): ingest.demand_signals handler writes public-holiday signals"
```

---

### Task 5 (optional): Add holidays to the dataplane demo seed

`shared/contracts/demo-seed.md` lists `demand_signals` as **optional** for the dataplane seeder. Including it makes the demo world show real signals.

**Files:**
- Modify: `dataplane/src/pricepilot/demo/seed.py` (call `ingest_holidays` in `seed()`, add `demand_signals_written` to the summary dict)
- Modify: `dataplane/tests/integration/test_engine_e2e.py` (extend `test_demo_seed_is_idempotent` window-scoped assertion to cover the new count, or add a sibling assertion)

- [ ] **Step 1:** In `seed()` after the scrape-run block, add `signals = ingest_holidays(session, city="sibiu", today=today)` and include `"demand_signals_written": signals` in the returned summary. Import `ingest_holidays`.
- [ ] **Step 2:** Update/extend the idempotency test (window-scoped, same pattern as the existing rate count) so a re-seed keeps the holiday count stable.
- [ ] **Step 3:** `.venv\Scripts\python -m pytest -q` (DB up) green; `ruff` clean.
- [ ] **Step 4:** Commit `feat(dataplane): seed demo public-holiday signals (idempotent)`.

---

### Task 6: Docs, review, roadmap, final verification

**Files:**
- Modify: `dataplane/CLAUDE.md` (module map: `ingest/demand_signals.py`; note holidays now real)
- Modify: `docs/roadmap.md` (record the wave; move/annotate the demand-signals backlog line)

- [ ] **Step 1: `dataplane/CLAUDE.md`** — add a module-map row `| src/pricepilot/ingest/demand_signals.py | demand_signals upsert (uuid5 idempotent); holidays wired, tourism/weather TODO |` and update the `ingest/` line to reflect holidays being real.

- [ ] **Step 2: `docs/roadmap.md`** — add a short "Wave 2.3 (first demand signal)" entry: holidays → `demand_signals` ingestion wired into `ingest.demand_signals`; note it's the write path only (engine consumption is a follow-up). Leave `INS Tempo` / `weather` backlog lines; the `ingest.demand_signals` handler is no longer a blanket stub.

- [ ] **Step 3: Dispatch the repo `code-reviewer` agent** on the new commits (tenant isolation N/A — `demand_signals` is city-scoped; check idempotency, Decimal handling, schema-sync still green, no DDL). Address findings.

- [ ] **Step 4: Final verification — paste output:**
  - `.venv\Scripts\python -m pytest -q` with `$env:DATABASE_URL` set (full suite incl. integration) — 0 failures, nothing skipped that should run.
  - `.venv\Scripts\python -m ruff check src tests` — clean.
  - The manual `poll_once` check from Task 4 Step 4.
  - Confirm `dotnet` side untouched (no schema change) — no backend build needed, but state it explicitly in the PR.

- [ ] **Step 5: Commit docs** — `docs: record demand-signals holidays ingestion (wave 2.3)`.

---

## Definition of done (repo rules)

- [ ] Unit + integration tests written and passing (`pytest` with DB); `ruff` clean.
- [ ] **No** contract change required — `demand_signals` shape unchanged (state this explicitly in the PR so reviewers don't look for a missing EF migration).
- [ ] No DDL emitted from Python; schema-sync integration test still green.
- [ ] `demand_signals` is city-scoped (no tenant filter needed) — documented in the ingest module.
- [ ] Code-reviewer agent ran; findings addressed.
- [ ] `dataplane/CLAUDE.md` + `docs/roadmap.md` updated.

## Follow-ups (explicitly NOT in this plan)

1. **Engine consumption of holidays** — add a `holiday` (or `holiday_weekend`) rule, or feed holidays into a demand factor; populate the read in `_load_rule_contexts` and extend `recommendation-factors.md` + `ENGINE_VERSION` if the payload shape changes. This is what actually moves prices.
2. **`holidays` PyPI package** — replace the hardcoded 2026 list so any year works (existing TODO in `holidays.py`); this ingestion is unaffected.
3. **INS tourism stats → `avg_occupancy_by_month`** (`ingest/tourism_stats.py`) — the signal `seasonality` already knows how to read; needs the external INS Tempo API.
4. **Weather** (`ingest/weather.py`) — open-meteo; a future weather-sensitivity rule.
