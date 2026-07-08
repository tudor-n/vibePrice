import { describe, expect, it } from 'vitest';
import type { CalendarRow } from './calendarModel';
import {
  buildCalendarModel,
  monthLabel,
  monthsWithData,
  roomTypeNamesFrom,
} from './calendarModel';
import type { RecommendationFactors, RecommendationStatus } from '../../api/types';

/** Minimal factors payload builder (v1 has no band; v2 adds band_low/band_high). */
function factorsWith(options: {
  bandLow?: number;
  bandHigh?: number;
  eventIds?: string[];
  eventReason?: string;
} = {}): RecommendationFactors {
  const factors: RecommendationFactors['factors'] = [
    {
      rule: 'seasonality',
      adjustment_pct: 5,
      reason: 'June is high season in Sibiu.',
    },
  ];
  if (options.eventIds !== undefined) {
    factors.push({
      rule: 'event_impact',
      adjustment_pct: 12,
      reason: options.eventReason ?? 'FITS (impact 90/100) runs Jun 12-21.',
      event_ids: options.eventIds,
    });
  }
  const competitor: RecommendationFactors['factors'][number] = {
    rule: 'competitor_position',
    adjustment_pct: 3,
    reason: '8 of 10 tracked competitors raised prices.',
    sample_size: 10,
  };
  if (options.bandLow !== undefined) competitor.band_low = options.bandLow;
  if (options.bandHigh !== undefined) competitor.band_high = options.bandHigh;
  factors.push(competitor);

  return {
    engine_version: '2',
    base_price: 350,
    currency: 'RON',
    factors,
    recommended_price: 440,
    expected_impact: {
      estimate: 3400,
      currency: 'RON',
      period_start: '2026-06-12',
      period_end: '2026-06-21',
      method: 'occupancy-weighted delta vs current price',
    },
    data_freshness: {},
  };
}

let sequence = 0;

function row(options: {
  stayDate: string;
  roomTypeName?: string;
  status?: RecommendationStatus;
  currentPrice?: number;
  recommendedPrice?: number;
  factors?: RecommendationFactors;
  createdAt?: string;
}): CalendarRow {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    roomTypeId: 'room-1',
    roomTypeName: options.roomTypeName ?? 'Double Deluxe',
    stayDate: options.stayDate,
    currentPrice: options.currentPrice ?? 350,
    recommendedPrice: options.recommendedPrice ?? 440,
    currency: 'RON',
    expectedImpact: 3400,
    status: options.status ?? 'pending',
    factors: options.factors ?? factorsWith(),
    createdAt: options.createdAt ?? '2026-06-01T05:00:00Z',
  };
}

const ROOM = 'Double Deluxe';

describe('buildCalendarModel — grid shape', () => {
  it('always returns 6 weeks × 7 days starting on Monday', () => {
    // June 2026 starts on a Monday: no leading out-of-month cells.
    const days = buildCalendarModel([], '2026-06-01', ROOM);
    expect(days).toHaveLength(42);
    expect(days[0].date).toBe('2026-06-01');
    expect(days[29].date).toBe('2026-06-30');
    expect(days.slice(0, 30).every((d) => d.inMonth)).toBe(true);
    expect(days.slice(30).every((d) => !d.inMonth)).toBe(true);
    expect(days[41].date).toBe('2026-07-12');
  });

  it('marks leading days from the previous month as out-of-month', () => {
    // July 2026 starts on a Wednesday: Mon Jun 29 + Tue Jun 30 lead the grid.
    const days = buildCalendarModel([], '2026-07-01', ROOM);
    expect(days[0].date).toBe('2026-06-29');
    expect(days[0].inMonth).toBe(false);
    expect(days[1].date).toBe('2026-06-30');
    expect(days[1].inMonth).toBe(false);
    expect(days[2].date).toBe('2026-07-01');
    expect(days[2].inMonth).toBe(true);
  });

  it('flags Saturdays and Sundays as weekend', () => {
    const days = buildCalendarModel([], '2026-06-01', ROOM);
    const byDate = new Map(days.map((d) => [d.date, d]));
    expect(byDate.get('2026-06-06')?.isWeekend).toBe(true); // Saturday
    expect(byDate.get('2026-06-07')?.isWeekend).toBe(true); // Sunday
    expect(byDate.get('2026-06-08')?.isWeekend).toBe(false); // Monday
  });
});

describe('buildCalendarModel — price choice', () => {
  it('shows the recommended price for pending rows', () => {
    const pending = row({ stayDate: '2026-06-14', currentPrice: 350, recommendedPrice: 440 });
    const days = buildCalendarModel([pending], '2026-06-01', ROOM);
    const day = days.find((d) => d.date === '2026-06-14');
    expect(day?.price).toBe(440);
    expect(day?.currency).toBe('RON');
    expect(day?.hasPending).toBe(true);
    expect(day?.recommendationId).toBe(pending.id);
  });

  it('shows the current price for decided rows', () => {
    const accepted = row({
      stayDate: '2026-06-15',
      status: 'accepted',
      currentPrice: 350,
      recommendedPrice: 440,
    });
    const days = buildCalendarModel([accepted], '2026-06-01', ROOM);
    const day = days.find((d) => d.date === '2026-06-15');
    expect(day?.price).toBe(350);
    expect(day?.hasPending).toBe(false);
  });

  it('prefers the pending row when a day has both pending and decided rows', () => {
    const dismissed = row({
      stayDate: '2026-06-16',
      status: 'dismissed',
      currentPrice: 300,
    });
    const pending = row({
      stayDate: '2026-06-16',
      status: 'pending',
      recommendedPrice: 410,
    });
    const days = buildCalendarModel([dismissed, pending], '2026-06-01', ROOM);
    const day = days.find((d) => d.date === '2026-06-16');
    expect(day?.price).toBe(410);
    expect(day?.hasPending).toBe(true);
    expect(day?.recommendationId).toBe(pending.id);
  });

  it('leaves days without a matching row empty', () => {
    const days = buildCalendarModel(
      [row({ stayDate: '2026-06-14' })],
      '2026-06-01',
      ROOM,
    );
    const day = days.find((d) => d.date === '2026-06-02');
    expect(day?.price).toBeUndefined();
    expect(day?.hasPending).toBe(false);
    expect(day?.markerClass).toBeUndefined();
  });

  it('ignores rows of other room types', () => {
    const other = row({ stayDate: '2026-06-14', roomTypeName: 'Attic Single' });
    const days = buildCalendarModel([other], '2026-06-01', ROOM);
    expect(days.find((d) => d.date === '2026-06-14')?.price).toBeUndefined();
  });

  it('keeps out-of-month cells empty even when a row exists on that date', () => {
    const trailing = row({ stayDate: '2026-07-03' }); // in June's trailing cells
    const days = buildCalendarModel([trailing], '2026-06-01', ROOM);
    const day = days.find((d) => d.date === '2026-07-03');
    expect(day?.inMonth).toBe(false);
    expect(day?.price).toBeUndefined();
    expect(day?.hasPending).toBe(false);
  });
});

describe('buildCalendarModel — competitor band & marker', () => {
  function dayWithBand(price: number, low?: number, high?: number) {
    const pending = row({
      stayDate: '2026-06-14',
      recommendedPrice: price,
      factors: factorsWith({ bandLow: low, bandHigh: high }),
    });
    const days = buildCalendarModel([pending], '2026-06-01', ROOM);
    return days.find((d) => d.date === '2026-06-14')!;
  }

  it('derives the band position from band_low/band_high', () => {
    const day = dayWithBand(440, 380, 480);
    expect(day.bandLow).toBe(380);
    expect(day.bandHigh).toBe(480);
    expect(day.position).toBeCloseTo(0.6, 10);
    expect(day.markerClass).toBe('marker-well');
  });

  it('uses green below 0.42, amber from 0.42, terracotta from 0.72', () => {
    expect(dayWithBand(141, 100, 200).markerClass).toBe('marker-raise'); // 0.41
    expect(dayWithBand(142, 100, 200).markerClass).toBe('marker-well'); // 0.42 boundary
    expect(dayWithBand(171, 100, 200).markerClass).toBe('marker-well'); // 0.71
    expect(dayWithBand(172, 100, 200).markerClass).toBe('marker-top'); // 0.72 boundary
  });

  it('clamps the position into 0..1', () => {
    const above = dayWithBand(600, 380, 480);
    expect(above.position).toBe(1);
    expect(above.markerClass).toBe('marker-top');
    const below = dayWithBand(100, 380, 480);
    expect(below.position).toBe(0);
    expect(below.markerClass).toBe('marker-raise');
  });

  it('guards a degenerate band (low == high) as position 1', () => {
    const day = dayWithBand(400, 400, 400);
    expect(day.position).toBe(1);
    expect(day.markerClass).toBe('marker-top');
  });

  it('shows no marker when the band is absent (factors v1 rows)', () => {
    const day = dayWithBand(440); // no band keys at all
    expect(day.price).toBe(440);
    expect(day.bandLow).toBeUndefined();
    expect(day.bandHigh).toBeUndefined();
    expect(day.position).toBeUndefined();
    expect(day.markerClass).toBeUndefined();
  });

  it('treats a half-present band as absent', () => {
    const day = dayWithBand(440, 380, undefined);
    expect(day.position).toBeUndefined();
    expect(day.markerClass).toBeUndefined();
  });

  it('never crashes on malformed factors payloads', () => {
    const broken = row({ stayDate: '2026-06-14' });
    broken.factors = { engine_version: '9' } as unknown as RecommendationFactors;
    const days = buildCalendarModel([broken], '2026-06-01', ROOM);
    const day = days.find((d) => d.date === '2026-06-14');
    expect(day?.price).toBe(440); // top-level price still renders
    expect(day?.markerClass).toBeUndefined();
    expect(day?.eventName).toBeUndefined();
  });
});

describe('buildCalendarModel — event flag', () => {
  it('flags the day when event_impact has non-empty event_ids, carrying the reason', () => {
    const pending = row({
      stayDate: '2026-06-14',
      factors: factorsWith({
        eventIds: ['0d9c3f9a-9a1f-4a8f-9a55-1c2b3d4e5f60'],
        eventReason: 'FITS (impact 90/100) runs Jun 12-21.',
      }),
    });
    const days = buildCalendarModel([pending], '2026-06-01', ROOM);
    expect(days.find((d) => d.date === '2026-06-14')?.eventName).toBe(
      'FITS (impact 90/100) runs Jun 12-21.',
    );
  });

  it('does not flag when event_ids is empty or the factor is missing', () => {
    const emptyIds = row({
      stayDate: '2026-06-14',
      factors: factorsWith({ eventIds: [] }),
    });
    const noFactor = row({ stayDate: '2026-06-15' });
    const days = buildCalendarModel([emptyIds, noFactor], '2026-06-01', ROOM);
    expect(days.find((d) => d.date === '2026-06-14')?.eventName).toBeUndefined();
    expect(days.find((d) => d.date === '2026-06-15')?.eventName).toBeUndefined();
  });
});

describe('room types and month bounds', () => {
  it('derives unique room type names alphabetically (first = default)', () => {
    const rows = [
      row({ stayDate: '2026-06-14', roomTypeName: 'Double Deluxe' }),
      row({ stayDate: '2026-06-15', roomTypeName: 'Attic Single' }),
      row({ stayDate: '2026-06-16', roomTypeName: 'Double Deluxe' }),
    ];
    expect(roomTypeNamesFrom(rows)).toEqual(['Attic Single', 'Double Deluxe']);
  });

  it('derives the sorted unique list of month starts that have data', () => {
    const rows = [
      row({ stayDate: '2026-08-02' }),
      row({ stayDate: '2026-06-14' }),
      row({ stayDate: '2026-06-20' }),
    ];
    expect(monthsWithData(rows)).toEqual(['2026-06-01', '2026-08-01']);
  });

  it('formats the month label', () => {
    expect(monthLabel('2026-06-01')).toBe('June 2026');
  });
});
