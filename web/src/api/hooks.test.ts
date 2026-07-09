import { describe, expect, it } from 'vitest';
import { competitorsRefetchInterval, propertiesRefetchInterval } from './hooks';
import type { Competitor, Property } from './types';

function property(overrides: Partial<Property>): Property {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Casa Luca',
    city: 'Sibiu',
    placeStatus: 'resolved',
    placeCandidates: [],
    roomTypes: [],
    ...overrides,
  };
}

function competitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Hotel Continental',
    latestRates: [],
    ...overrides,
  };
}

describe('propertiesRefetchInterval', () => {
  it('polls every 3s while any property is unresolved', () => {
    const rows = [property({ placeStatus: 'resolved' }), property({ placeStatus: 'unresolved' })];
    expect(propertiesRefetchInterval(rows)).toBe(3000);
  });

  it('stops polling once every property has settled (resolved or failed)', () => {
    const rows = [property({ placeStatus: 'resolved' }), property({ placeStatus: 'failed' })];
    expect(propertiesRefetchInterval(rows)).toBe(false);
  });

  it('does not poll when there is no data yet', () => {
    expect(propertiesRefetchInterval(undefined)).toBe(false);
  });

  it('does not poll an empty property list', () => {
    expect(propertiesRefetchInterval([])).toBe(false);
  });
});

describe('competitorsRefetchInterval', () => {
  it('polls every 3s while there is no data yet', () => {
    expect(competitorsRefetchInterval(undefined)).toBe(3000);
  });

  it('polls every 3s while zero competitors have been discovered', () => {
    expect(competitorsRefetchInterval([])).toBe(3000);
  });

  it('stops polling once at least one competitor is discovered', () => {
    expect(competitorsRefetchInterval([competitor()])).toBe(false);
  });
});
