import { describe, expect, it } from 'vitest';
import { propertiesRefetchInterval } from './hooks';
import type { Property } from './types';

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
