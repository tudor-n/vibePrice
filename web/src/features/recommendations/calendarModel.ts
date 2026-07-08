/**
 * Pure derivation of the month price calendar from recommendation rows.
 * No fetching, no DOM, no Date.now() — fully unit-testable.
 *
 * Money discipline: every number here (prices, band bounds) is a
 * server-provided figure passed through untouched. The only derived value is
 * `position` — where the price sits inside the competitor band — which is a
 * ratio for placing a marker, not a money figure.
 *
 * Factors compatibility: the band comes from the `competitor_position`
 * factor's `band_low`/`band_high` (factors v2,
 * shared/contracts/recommendation-factors.md). v1 rows have no band — such
 * days simply render without a marker. Event days come from the
 * `event_impact` factor's non-empty `event_ids`; the pill tooltip is that
 * factor's `reason` sentence — event names are never re-derived client-side.
 */

import type { Recommendation, RecommendationFactor } from '../../api/types';

/** A recommendation joined with its room type's display name. */
export type CalendarRow = Recommendation & { roomTypeName: string };

export type MarkerClass = 'marker-raise' | 'marker-well' | 'marker-top';

export interface CalendarDay {
  /** ISO stay date (yyyy-mm-dd). */
  date: string;
  inMonth: boolean;
  isWeekend: boolean;
  price?: number;
  currency?: string;
  bandLow?: number;
  bandHigh?: number;
  /** Where the price sits in the competitor band, clamped 0..1. */
  position?: number;
  markerClass?: MarkerClass;
  /** The event_impact factor's reason sentence (pill tooltip), when the day has events. */
  eventName?: string;
  hasPending: boolean;
  recommendationId?: string;
}

const DAY_MS = 86_400_000;
const WEEKS = 6;
const GRID_SIZE = WEEKS * 7;

/** Marker thresholds: green < 0.42, amber < 0.72, terracotta otherwise. */
const MARKER_AMBER_FROM = 0.42;
const MARKER_TOP_FROM = 0.72;

function isoToUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcMsToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** First day of the ISO date's month, as ISO. */
function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function findFactor(row: Recommendation, rule: string): RecommendationFactor | undefined {
  const factors = row.factors?.factors;
  if (!Array.isArray(factors)) return undefined;
  return factors.find((factor) => factor?.rule === rule);
}

function bandOf(row: Recommendation): { low: number; high: number } | null {
  // The band caption borrows the cell price's currency symbol, so the factors
  // payload currency must agree with the row's — guard against future engine
  // versions ever diverging (today they never do).
  const payloadCurrency = row.factors?.currency;
  if (typeof payloadCurrency === 'string' && payloadCurrency !== row.currency) {
    return null;
  }
  const factor = findFactor(row, 'competitor_position');
  const low = factor?.band_low;
  const high = factor?.band_high;
  // Tolerate absence (factors v1) and half-present payloads: no band, no marker.
  if (typeof low !== 'number' || typeof high !== 'number') return null;
  return { low, high };
}

function eventReasonOf(row: Recommendation): string | undefined {
  const factor = findFactor(row, 'event_impact');
  if (!factor) return undefined;
  const ids = factor.event_ids;
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  return typeof factor.reason === 'string' ? factor.reason : undefined;
}

function markerClassFor(position: number): MarkerClass {
  if (position < MARKER_AMBER_FROM) return 'marker-raise';
  if (position < MARKER_TOP_FROM) return 'marker-well';
  return 'marker-top';
}

/**
 * Pick the row that represents a day: pending beats decided (the calendar
 * shows what needs a decision); ties break on newest createdAt.
 */
function pickRow(candidates: CalendarRow[]): CalendarRow | undefined {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1;
    const bPending = b.status === 'pending' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return b.createdAt.localeCompare(a.createdAt);
  })[0];
}

/** Unique room type names, alphabetical — the first is the default selection. */
export function roomTypeNamesFrom(rows: CalendarRow[]): string[] {
  return [...new Set(rows.map((row) => row.roomTypeName))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Sorted unique first-of-month ISO dates covered by the rows (nav bounds). */
export function monthsWithData(rows: CalendarRow[]): string[] {
  return [...new Set(rows.map((row) => monthStartOf(row.stayDate)))].sort();
}

/** "June 2026" for a first-of-month ISO date. */
export function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(isoToUtcMs(monthStart));
}

/**
 * Build the 6×7 Monday-first grid for one month and one room type.
 * Out-of-month cells stay empty even when data exists for those dates —
 * their numbers belong to the neighbouring month's page.
 */
export function buildCalendarModel(
  rows: CalendarRow[],
  monthStart: string,
  roomTypeName: string,
): CalendarDay[] {
  const monthKey = monthStart.slice(0, 7);
  const monthStartMs = isoToUtcMs(monthStart);
  const leadingDays = (new Date(monthStartMs).getUTCDay() + 6) % 7; // Monday = 0
  const gridStartMs = monthStartMs - leadingDays * DAY_MS;

  const byDate = new Map<string, CalendarRow[]>();
  for (const row of rows) {
    if (row.roomTypeName !== roomTypeName) continue;
    const bucket = byDate.get(row.stayDate);
    if (bucket) {
      bucket.push(row);
    } else {
      byDate.set(row.stayDate, [row]);
    }
  }

  const days: CalendarDay[] = [];
  for (let i = 0; i < GRID_SIZE; i += 1) {
    const dateMs = gridStartMs + i * DAY_MS;
    const date = utcMsToIso(dateMs);
    const dow = new Date(dateMs).getUTCDay();
    const day: CalendarDay = {
      date,
      inMonth: date.slice(0, 7) === monthKey,
      isWeekend: dow === 0 || dow === 6,
      hasPending: false,
    };

    const row = day.inMonth ? pickRow(byDate.get(date) ?? []) : undefined;
    if (row) {
      const pending = row.status === 'pending';
      day.hasPending = pending;
      day.recommendationId = row.id;
      // Pending rows show the suggestion; decided rows show today's price.
      day.price = pending ? row.recommendedPrice : row.currentPrice;
      day.currency = row.currency;
      day.eventName = eventReasonOf(row);

      const band = bandOf(row);
      if (band) {
        day.bandLow = band.low;
        day.bandHigh = band.high;
        // Display-only ratio; degenerate band (low == high) pins to the top.
        const span = band.high - band.low;
        const raw = span === 0 ? 1 : (day.price - band.low) / span;
        day.position = Math.min(1, Math.max(0, raw));
        day.markerClass = markerClassFor(day.position);
      }
    }

    days.push(day);
  }
  return days;
}
