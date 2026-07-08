import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { RecommendationsPage } from './RecommendationsPage';
import { PropertyProvider } from '../../app/PropertyContext';
import { renderWithProviders } from '../../test/renderWithProviders';
import { fixtureFactors, fixtureRecommendationV2 } from '../../test/fixtures';
import type { Property, Recommendation } from '../../api/types';

const ROOM_DOUBLE = '2b4d6e8f-0a1b-4c2d-9e3f-abcdefabcdef';
const ROOM_ATTIC = '5f6e7d8c-1b2a-4c3d-8e9f-fedcba987654';

const property: Property = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Casa Luca',
  city: 'Sibiu',
  roomTypes: [
    {
      id: ROOM_DOUBLE,
      name: 'Double Deluxe',
      capacity: 2,
      basePrice: 350,
      currentPrice: 350,
      currency: 'RON',
    },
    {
      id: ROOM_ATTIC,
      name: 'Attic Single',
      capacity: 1,
      basePrice: 220,
      currentPrice: 220,
      currency: 'RON',
    },
  ],
};

// Pending row for the Double Deluxe (factors v2: has the competitor band).
const doubleRec: Recommendation = {
  ...fixtureRecommendationV2,
  roomTypeId: ROOM_DOUBLE,
  stayDate: '2026-06-14',
};

// Pending row for the Attic Single (factors v1: no band — must still render).
const atticRec: Recommendation = {
  ...fixtureRecommendationV2,
  id: '9b2c4d6e-8f0a-4b1c-9d2e-3456789abcde',
  roomTypeId: ROOM_ATTIC,
  stayDate: '2026-06-20',
  recommendedPrice: 260,
  factors: fixtureFactors,
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();
let recommendationRows: Recommendation[] = [];

beforeEach(() => {
  recommendationRows = [doubleRec, atticRec];
  localStorage.setItem('pricepilot.tenantId', '11111111-1111-4111-8111-111111111111');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? 'GET';
    if (url.includes('/recommendations')) {
      return jsonResponse(recommendationRows);
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
      <RecommendationsPage />
    </PropertyProvider>,
  );
}

describe('RecommendationsPage — price calendar', () => {
  it('defaults the room type to the alphabetically first and switches on select', async () => {
    renderPage();
    const select = await screen.findByLabelText('Room type');
    expect(select).toHaveValue('Attic Single');
    expect(screen.getByText('Casa Luca · Attic Single')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'Double Deluxe' } });
    expect(screen.getByText('Casa Luca · Double Deluxe')).toBeInTheDocument();

    // The Double Deluxe row carries a factors-v2 band → range caption shows.
    expect(screen.getByText(/vs 380–455/)).toBeInTheDocument();
  });

  it('bounds month navigation to months that have data', async () => {
    renderPage();
    await screen.findByLabelText('Room type');
    // All fixture rows live in June 2026 — a single month, so both ends stop.
    const calendar = screen.getByRole('region', { name: 'Price calendar' });
    expect(
      within(calendar).getByRole('heading', { name: 'June 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('clicking a pending day cell highlights the matching recommendation card', async () => {
    renderPage();
    // Attic Single is the default room; its pending night is 20 June.
    const dayButton = await screen.findByRole('button', {
      name: 'Review the suggested price for 20 June 2026',
    });
    fireEvent.click(dayButton);

    const anchor = document.getElementById(`rec-${atticRec.id}`);
    expect(anchor).not.toBeNull();
    expect(anchor!.querySelector('article')).toHaveClass('rec-card-highlight');
  });

  it('shows the illustrated empty state when there are no recommendations', async () => {
    recommendationRows = [];
    renderPage();
    expect(await screen.findByText('All quiet on your street')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Price calendar' })).toBeNull();
  });
});
