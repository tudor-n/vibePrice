import { describe, expect, it } from 'vitest';
import { deriveStep } from './useSetupProgress';
import type { Property } from '../../api/types';

function property(overrides: Partial<Property>): Property {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Casa Luca',
    city: 'Sibiu',
    placeStatus: 'unresolved',
    placeCandidates: [],
    roomTypes: [],
    ...overrides,
  };
}

describe('deriveStep', () => {
  it('no properties -> step 1 (name)', () => {
    expect(deriveStep([])).toEqual({ step: 1 });
  });

  it('property exists, unresolved -> step 2 (confirm place)', () => {
    const p = property({ placeStatus: 'unresolved' });
    expect(deriveStep([p])).toEqual({ step: 2, property: p });
  });

  it('property exists, failed -> step 2 (confirm place, offers re-search)', () => {
    const p = property({ placeStatus: 'failed' });
    expect(deriveStep([p])).toEqual({ step: 2, property: p });
  });

  it('property resolved, no room types -> step 3 (room)', () => {
    const p = property({ placeStatus: 'resolved' });
    expect(deriveStep([p])).toEqual({ step: 3, property: p });
  });

  it('property resolved, >=1 room type -> step 4 (competitors)', () => {
    const p = property({
      placeStatus: 'resolved',
      roomTypes: [
        { id: 'r1', name: 'Double room', capacity: 2, basePrice: 300, currentPrice: 300, currency: 'RON' },
      ],
    });
    expect(deriveStep([p])).toEqual({ step: 4, property: p });
  });

  it('onboarding is single-property: uses the first property when several exist', () => {
    const first = property({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', placeStatus: 'unresolved' });
    const second = property({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', placeStatus: 'resolved' });
    expect(deriveStep([first, second])).toEqual({ step: 2, property: first });
  });
});
