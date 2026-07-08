import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { CompetitorsPage, haversineDistanceKm } from './CompetitorsPage';
import { PropertyProvider } from '../../app/PropertyContext';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Competitor, Property } from '../../api/types';

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';

const property: Property = {
  id: PROPERTY_ID,
  name: 'Casa Luca',
  city: 'Sibiu',
  latitude: 45.7983,
  longitude: 24.1256,
  placeStatus: 'resolved',
  placeCandidates: [],
  roomTypes: [],
};

const nearbyCompetitor: Competitor = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Hotel Împăratul Romanilor',
  sourceUrl: 'https://www.booking.com/hotel/imparatul',
  rating: 4.3,
  ratingCount: 512,
  latitude: 45.7975,
  longitude: 24.1521,
  latestRates: [
    { stayDate: '2026-07-10', price: 420, currency: 'RON', capturedAt: '2026-07-08T04:00:00Z' },
  ],
};

const noCoordsCompetitor: Competitor = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Pensiunea Fără Coordonate',
  rating: 4.0,
  ratingCount: 12,
  latestRates: [],
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();
let competitorRows: Competitor[] = [];
let deletedIds: string[] = [];

beforeEach(() => {
  competitorRows = [nearbyCompetitor, noCoordsCompetitor];
  deletedIds = [];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'DELETE' && url.includes('/competitors/')) {
      const id = url.split('/competitors/')[1];
      deletedIds.push(id);
      competitorRows = competitorRows.filter((c) => c.id !== id);
      return new Response(null, { status: 204 });
    }
    if (url.includes('/competitors')) {
      return jsonResponse(competitorRows);
    }
    if (url.endsWith('/properties')) {
      return jsonResponse([property]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  });
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderPage() {
  return renderWithProviders(
    <PropertyProvider>
      <CompetitorsPage />
    </PropertyProvider>,
  );
}

describe('haversineDistanceKm', () => {
  it('returns ~0 for the same point', () => {
    expect(haversineDistanceKm(45.7983, 24.1256, 45.7983, 24.1256)).toBeCloseTo(0, 5);
  });

  it('returns a plausible distance between two nearby Sibiu points', () => {
    const km = haversineDistanceKm(45.7983, 24.1256, 45.7975, 24.1521);
    // These two points are a couple of km apart in central Sibiu.
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(3);
  });
});

describe('CompetitorsPage — states', () => {
  it('shows a loading state while properties load', () => {
    renderPage();
    expect(screen.getByText(/Loading your properties/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no properties', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/properties')) return jsonResponse([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    renderPage();
    expect(await screen.findByText(/Add a property in Settings/)).toBeInTheDocument();
  });

  it('shows an empty state when no competitors are discovered yet', async () => {
    competitorRows = [];
    renderPage();
    expect(await screen.findByText(/No competitors discovered yet/)).toBeInTheDocument();
  });
});

describe('CompetitorsPage — discovered list (read-only)', () => {
  it('renders name, rating + review count, and distance when coordinates are known', async () => {
    renderPage();
    expect(await screen.findByText('Hotel Împăratul Romanilor')).toBeInTheDocument();
    expect(screen.getByText(/★ 4.3 \(512 reviews\)/)).toBeInTheDocument();
    expect(screen.getByText(/km away/)).toBeInTheDocument();
    expect(screen.getByText('View listing')).toBeInTheDocument();
  });

  it('omits distance when either property or competitor coordinates are absent', async () => {
    renderPage();
    await screen.findByText('Pensiunea Fără Coordonate');
    const row = screen.getByText('Pensiunea Fără Coordonate').closest('section') as HTMLElement;
    expect(row.textContent).not.toMatch(/km away/);
    // No sourceUrl on this fixture either.
    expect(row.textContent).not.toMatch(/View listing/);
  });

  it('has no add-competitor form', async () => {
    renderPage();
    await screen.findByText('Hotel Împăratul Romanilor');
    expect(screen.queryByLabelText(/competitor name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /track a new competitor/i })).not.toBeInTheDocument();
  });
});

describe('CompetitorsPage — untrack with confirm', () => {
  it('requires confirmation before calling DELETE, and cancel backs out', async () => {
    renderPage();
    const row = (await screen.findByText('Hotel Împăratul Romanilor')).closest(
      'section',
    ) as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: 'Untrack' }));
    expect(
      within(row).getByText('This competitor stays removed from your tracking.'),
    ).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByText('This competitor stays removed from your tracking.'),
    ).not.toBeInTheDocument();
    expect(deletedIds).toEqual([]);
  });

  it('confirming calls DELETE and the row disappears', async () => {
    renderPage();
    const row = (await screen.findByText('Hotel Împăratul Romanilor')).closest(
      'section',
    ) as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: 'Untrack' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, untrack' }));

    await waitFor(() => {
      expect(deletedIds).toEqual([nearbyCompetitor.id]);
    });
    await waitFor(() => {
      expect(screen.queryByText('Hotel Împăratul Romanilor')).not.toBeInTheDocument();
    });
  });
});
