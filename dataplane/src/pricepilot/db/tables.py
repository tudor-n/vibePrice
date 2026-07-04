"""Schema owned by backend EF Core migrations — mapping only, never emit DDL.

These SQLAlchemy models map tables that already exist in PostgreSQL; the C#
backend creates and alters them exclusively via EF Core migrations (see
``shared/contracts/table-ownership.md``). Never call ``Base.metadata.create_all``
/ ``drop_all`` or use Alembic against this metadata. Any schema change must be
coordinated with a backend EF migration and a ``table-ownership.md`` update in
the same PR.

Conventions (from the contract): snake_case identifiers, ``id UUID`` primary
keys, money as ``numeric(10,2)`` + ``currency char(3)``, stay dates as ``date``,
instants as UTC ``timestamptz`` named ``*_at``.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import TIMESTAMP, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Declarative base. Mapping only — never emit DDL from this metadata."""

    type_annotation_map = {
        uuid.UUID: UUID(as_uuid=True),
        datetime: TIMESTAMP(timezone=True),
        date: Date,
        dict[str, Any]: JSONB,
    }


# --------------------------------------------------------------------------
# Backend-written tables (dataplane reads only)
# --------------------------------------------------------------------------


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime]


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    email: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime]


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime]


class RoomType(Base):
    __tablename__ = "room_types"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    name: Mapped[str] = mapped_column(String(200))
    capacity: Mapped[int] = mapped_column(Integer)
    base_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    current_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))


class Competitor(Base):
    __tablename__ = "competitors"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    name: Mapped[str] = mapped_column(String(200))
    source_url: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime]


# --------------------------------------------------------------------------
# Dataplane-written tables
# --------------------------------------------------------------------------


class ScrapedRate(Base):
    __tablename__ = "scraped_rates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    competitor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("competitors.id"))
    stay_date: Mapped[date]
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    captured_at: Mapped[datetime] = mapped_column(default=_utcnow)


class ScrapeRun(Base):
    __tablename__ = "scrape_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(50))
    started_at: Mapped[datetime] = mapped_column(default=_utcnow)
    finished_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(Text)


class Event(Base):
    """City-scoped, not tenant-scoped."""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    city: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    start_date: Mapped[date]
    end_date: Mapped[date]
    impact_score: Mapped[int] = mapped_column(Integer)  # 0-100
    source: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)


class DemandSignal(Base):
    """City-scoped public stats time series (INS, weather, holidays)."""

    __tablename__ = "demand_signals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    city: Mapped[str] = mapped_column(String(100))
    signal_type: Mapped[str] = mapped_column(String(100))
    signal_date: Mapped[date]
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    source: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)


class Recommendation(Base):
    """Dataplane INSERTs rows; backend UPDATEs `status` only (pending → accepted/dismissed)."""

    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    room_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("room_types.id"))
    stay_date: Mapped[date]
    current_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    recommended_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    expected_impact: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    factors: Mapped[dict[str, Any]]  # shape: shared/contracts/recommendation-factors.md
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    decided_at: Mapped[datetime | None]  # backend-written when status leaves 'pending'


class OwnBooking(Base):
    """Future ingestion of the hotel's own booking history — unused in v1."""

    __tablename__ = "own_bookings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    room_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("room_types.id"))
    stay_date: Mapped[date]
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    booked_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)


class Job(Base):
    """Backend INSERTs (dashboard "refresh now"); dataplane claims and updates.

    Types and payloads: ``shared/contracts/jobs.md``.
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict[str, Any]]
    status: Mapped[str] = mapped_column(String(20), default="queued")
    result: Mapped[dict[str, Any] | None]
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    requested_by: Mapped[uuid.UUID | None]  # user id when triggered from the dashboard
