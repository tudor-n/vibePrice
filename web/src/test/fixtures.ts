import type { Recommendation, RecommendationFactors } from '../api/types';

/**
 * Fixture matching the example payload in
 * `shared/contracts/recommendation-factors.md`, plus an unknown rule and
 * unknown extra fields to prove the renderer tolerates future engine
 * versions (backward compatibility is a contract requirement).
 */
export const fixtureFactors: RecommendationFactors = {
  engine_version: '1',
  base_price: 350.0,
  currency: 'RON',
  factors: [
    {
      rule: 'seasonality',
      adjustment_pct: 5.0,
      reason: 'June is high season in Sibiu (avg occupancy 78%).',
    },
    {
      rule: 'event_impact',
      adjustment_pct: 12.0,
      reason: 'FITS (impact 90/100) runs Jun 12-21.',
      event_ids: ['0d9c3f9a-9a1f-4a8f-9a55-1c2b3d4e5f60'],
    },
    {
      rule: 'competitor_position',
      adjustment_pct: 3.0,
      reason: '8 of 10 tracked competitors raised prices ~15% for these dates.',
      sample_size: 10,
    },
    {
      rule: 'day_of_week',
      adjustment_pct: 0.0,
      reason: 'Friday: weekend demand bump.',
    },
    {
      rule: 'lead_time',
      adjustment_pct: -2.0,
      reason: 'Stay is 6 days out; slight discount to capture late bookers.',
    },
    {
      // A rule this UI version has never heard of — the reason must render anyway.
      rule: 'mystery_future_rule',
      adjustment_pct: 1.5,
      reason: 'A brand-new engine signal this dashboard version does not know.',
      some_future_field: { nested: true },
    },
  ],
  recommended_price: 413.0,
  expected_impact: {
    estimate: 3400.0,
    currency: 'RON',
    period_start: '2026-06-12',
    period_end: '2026-06-21',
    method: 'occupancy-weighted delta vs current price',
  },
  data_freshness: {
    scraped_rates_at: '2026-06-01T04:10:00Z',
    events_at: '2026-05-30T02:00:00Z',
  },
  // Unknown top-level field from a future engine version.
  experimental_diagnostics: { model: 'rules-v1' },
};

export const fixtureRecommendation: Recommendation = {
  id: '7f0a2f9e-4b7c-4c1d-8e0f-123456789abc',
  roomTypeId: '2b4d6e8f-0a1b-4c2d-9e3f-abcdefabcdef',
  stayDate: '2026-06-12',
  currentPrice: 350.0,
  recommendedPrice: 413.0,
  currency: 'RON',
  expectedImpact: 3400.0,
  status: 'pending',
  factors: fixtureFactors,
  createdAt: '2026-06-01T05:00:00Z',
};

/**
 * Factors v2 (shared/contracts/recommendation-factors.md): the
 * `competitor_position` factor carries `band_low`/`band_high` — the min/max
 * of the competitor rates used for that stay date. The price calendar
 * consumes these; v1 rows (above) must keep rendering without a band.
 */
export const fixtureFactorsV2: RecommendationFactors = {
  ...fixtureFactors,
  engine_version: '2',
  factors: fixtureFactors.factors.map((factor) =>
    factor.rule === 'competitor_position'
      ? { ...factor, band_low: 380.0, band_high: 455.0 }
      : factor,
  ),
};

export const fixtureRecommendationV2: Recommendation = {
  ...fixtureRecommendation,
  id: '8a1b3c0f-5c8d-4d2e-9f10-23456789abcd',
  stayDate: '2026-06-14',
  factors: fixtureFactorsV2,
};
