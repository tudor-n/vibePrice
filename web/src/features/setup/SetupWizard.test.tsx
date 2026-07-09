import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SetupWizard } from './SetupWizard';
import { SetupGuard } from './SetupGuard';
import { StepCompetitors } from './steps/StepCompetitors';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Competitor, Property, Recommendation } from '../../api/types';

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';

const unresolvedNoCandidates: Property = {
  id: PROPERTY_ID,
  name: 'Casa Luca',
  city: 'Sibiu',
  placeStatus: 'unresolved',
  placeCandidates: [],
  roomTypes: [],
};

const unresolvedWithCandidates: Property = {
  ...unresolvedNoCandidates,
  placeCandidates: [
    { placeId: 'place-1', name: 'Casa Luca', formattedAddress: 'Strada Nicolae Bălcescu 12, Sibiu' },
    { placeId: 'place-2', name: 'Casa Luca Boutique', formattedAddress: 'Strada Mitropoliei 5, Sibiu' },
  ],
};

const failedProperty: Property = {
  ...unresolvedNoCandidates,
  placeStatus: 'failed',
};

const resolvedNoRooms: Property = {
  ...unresolvedNoCandidates,
  placeStatus: 'resolved',
  address: 'Strada Nicolae Bălcescu 12, Sibiu',
  placeCandidates: unresolvedWithCandidates.placeCandidates,
  roomTypes: [],
};

const resolvedWithRooms: Property = {
  ...resolvedNoRooms,
  roomTypes: [
    { id: 'room-1', name: 'Double room', capacity: 2, basePrice: 350, currentPrice: 350, currency: 'RON' },
  ],
};

const discoveredCompetitors: Competitor[] = [
  { id: 'comp-1', name: 'Hotel Continental', rating: 4.3, ratingCount: 512, latestRates: [] },
  { id: 'comp-2', name: 'Pensiunea Rustic', latestRates: [] },
];

const firstRecommendation: Recommendation = {
  id: 'rec-1',
  roomTypeId: 'room-1',
  stayDate: '2026-08-01',
  currentPrice: 350,
  recommendedPrice: 399,
  currency: 'RON',
  expectedImpact: 500,
  status: 'pending',
  factors: {
    engine_version: '1',
    base_price: 350,
    currency: 'RON',
    factors: [
      { rule: 'seasonality', adjustment_pct: 8, reason: 'August is peak season in Sibiu.' },
    ],
    recommended_price: 399,
    expected_impact: {
      estimate: 500,
      currency: 'RON',
      period_start: '2026-08-01',
      period_end: '2026-08-01',
      method: 'test-fixture',
    },
    data_freshness: {},
  },
  createdAt: '2026-07-09T00:00:00Z',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface JobBody {
  type: string;
  payload?: Record<string, unknown>;
}

const fetchMock = vi.fn<typeof fetch>();
let propertyRows: Property[] = [];
let competitorRows: Competitor[] = [];
let recommendationRows: Recommendation[] = [];
let lastCreateBody: unknown = null;
let lastPickBody: unknown = null;
let lastRoomBody: unknown = null;
let jobBodies: JobBody[] = [];

beforeEach(() => {
  propertyRows = [];
  competitorRows = [];
  recommendationRows = [];
  lastCreateBody = null;
  lastPickBody = null;
  lastRoomBody = null;
  jobBodies = [];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.endsWith('/properties')) {
      lastCreateBody = JSON.parse(String(init?.body));
      // Simulate the resolve_place job having already produced candidates by
      // the time the owner reaches the confirm-place step.
      propertyRows = [unresolvedWithCandidates];
      return jsonResponse(unresolvedWithCandidates, 201);
    }
    if (method === 'PATCH' && url.includes('/place')) {
      lastPickBody = JSON.parse(String(init?.body));
      propertyRows = [resolvedNoRooms];
      return jsonResponse(resolvedNoRooms, 200);
    }
    if (method === 'POST' && url.includes('/room-types')) {
      lastRoomBody = JSON.parse(String(init?.body));
      propertyRows = [resolvedWithRooms];
      return jsonResponse(resolvedWithRooms.roomTypes[0], 201);
    }
    if (method === 'GET' && url.endsWith('/properties')) {
      return jsonResponse(propertyRows);
    }
    if (method === 'GET' && url.includes('/competitors')) {
      return jsonResponse(competitorRows);
    }
    if (method === 'GET' && url.includes('/recommendations')) {
      return jsonResponse(recommendationRows);
    }
    if (method === 'POST' && url.endsWith('/jobs')) {
      const body = JSON.parse(String(init?.body)) as JobBody;
      jobBodies.push(body);
      return jsonResponse(
        {
          id: `00000000-0000-4000-8000-00000000000${jobBodies.length}`,
          type: body.type,
          status: 'queued',
          createdAt: new Date().toISOString(),
        },
        202,
      );
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  });
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SetupWizard — full-screen chrome', () => {
  it('renders with no sidebar/topbar navigation', async () => {
    renderWithProviders(<SetupWizard />);
    await screen.findByRole('heading', { name: "What's your hotel called?" });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('moves focus to the step heading on mount', async () => {
    renderWithProviders(<SetupWizard />);
    const heading = await screen.findByRole('heading', { name: "What's your hotel called?" });
    expect(document.activeElement).toBe(heading);
  });

  it('shows progress dots and a quiet skip link', async () => {
    renderWithProviders(<SetupWizard />);
    await screen.findByRole('heading', { name: "What's your hotel called?" });
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
  });
});

describe('SetupWizard — step 1: hotel name + town', () => {
  it('creates a property from name + town and advances to the confirm-place step', async () => {
    renderWithProviders(<SetupWizard />);
    await screen.findByLabelText("What's your hotel called?");

    fireEvent.change(screen.getByLabelText("What's your hotel called?"), {
      target: { value: 'Casa Luca' },
    });
    fireEvent.change(screen.getByLabelText('Which town?'), {
      target: { value: 'Sibiu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(lastCreateBody).toEqual({ name: 'Casa Luca', city: 'Sibiu' });
    });

    expect(await screen.findByText(/Casa Luca Boutique/)).toBeInTheDocument();
  });

  it('disables Continue until both fields are filled', async () => {
    renderWithProviders(<SetupWizard />);
    await screen.findByLabelText("What's your hotel called?");
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("What's your hotel called?"), {
      target: { value: 'Casa Luca' },
    });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Which town?'), { target: { value: 'Sibiu' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('SetupWizard — step 2: confirm the Google place', () => {
  it('shows a "finding your place" status while resolution has no candidates yet', async () => {
    propertyRows = [unresolvedNoCandidates];
    renderWithProviders(<SetupWizard />);
    expect(await screen.findByText('Finding your place on Google…')).toBeInTheDocument();
  });

  it('picks a candidate, PATCHes .../place, and advances to the room step', async () => {
    propertyRows = [unresolvedWithCandidates];
    renderWithProviders(<SetupWizard />);
    await screen.findByText(/Casa Luca Boutique/);

    fireEvent.click(screen.getByLabelText(/Casa Luca Boutique/));
    fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));

    await waitFor(() => {
      expect(lastPickBody).toEqual({ placeId: 'place-2' });
    });

    expect(await screen.findByRole('heading', { name: 'Add your first room type' })).toBeInTheDocument();
  });

  it('surfaces the re-search box for a failed resolution', async () => {
    propertyRows = [failedProperty];
    renderWithProviders(<SetupWizard />);
    expect(await screen.findByText(/couldn't find it/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Search by a different name')).toBeInTheDocument();
    expect(screen.queryByText('Pick the right place')).not.toBeInTheDocument();
  });
});

describe('SetupWizard — step 3: your room + rate', () => {
  it('creates a room type and POSTs .../room-types', async () => {
    propertyRows = [resolvedNoRooms];
    renderWithProviders(<SetupWizard />);
    await screen.findByLabelText('Room type name');

    fireEvent.change(screen.getByLabelText('Room type name'), { target: { value: 'Double room' } });
    fireEvent.change(screen.getByLabelText('Sleeps'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Price per night'), { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(lastRoomBody).toEqual({
        name: 'Double room',
        capacity: 2,
        basePrice: 350,
        currency: 'RON',
      });
    });

    expect(await screen.findByRole('heading', { name: /finding your competitors/i })).toBeInTheDocument();
  });
});

describe('SetupWizard — step 4: finding competitors', () => {
  it('shows a "finding hotels" status while none are discovered yet', async () => {
    propertyRows = [resolvedWithRooms];
    competitorRows = [];
    renderWithProviders(<SetupWizard />);
    expect(await screen.findByText('Finding hotels near you…')).toBeInTheDocument();
  });

  it('lists the discovered names + ratings once competitors already exist', async () => {
    // StepCompetitors rendered on its own: the wizard shell auto-advances
    // past step 4 the instant competitorCount > 0 (deriveStep has no
    // separate "acknowledged" gate — see useSetupProgress.ts), so this
    // branch of the step component is exercised directly here rather than
    // through the always-advancing <SetupWizard/>.
    propertyRows = [resolvedWithRooms];
    competitorRows = discoveredCompetitors;
    renderWithProviders(<StepCompetitors property={resolvedWithRooms} />);

    expect(await screen.findByText('Hotel Continental')).toBeInTheDocument();
    expect(screen.getByText('★ 4.3 (512 reviews)')).toBeInTheDocument();
    expect(screen.getByText('Pensiunea Rustic')).toBeInTheDocument();
    expect(screen.getByText('No rating yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByText('Finding hotels near you…')).not.toBeInTheDocument();
  });

  it('advances the wizard to step 5 once competitors are discovered', async () => {
    propertyRows = [resolvedWithRooms];
    competitorRows = [];
    renderWithProviders(<SetupWizard />);
    await screen.findByText('Finding hotels near you…');

    // The mocked competitors response becomes non-empty; useCompetitors
    // polls every 3s (competitorsRefetchInterval) so this settles on its
    // own, without a reload or any user action.
    competitorRows = discoveredCompetitors;

    expect(
      await screen.findByRole(
        'heading',
        { name: /let's see your first price/i },
        { timeout: 6000 },
      ),
    ).toBeInTheDocument();
  });
});

describe('SetupWizard — step 5: your first price', () => {
  it('running the pipeline triggers the 3 jobs in order, then shows the first recommendation', async () => {
    propertyRows = [resolvedWithRooms];
    competitorRows = discoveredCompetitors;
    recommendationRows = [];
    renderWithProviders(<SetupWizard />, {
      route: '/setup',
      path: '/setup',
      routes: [{ path: '/', element: <p>dashboard</p> }],
    });

    const button = await screen.findByRole('button', { name: 'Show me my first price' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(jobBodies).toHaveLength(3);
    });
    expect(jobBodies.map((body) => body.type)).toEqual([
      'scrape.competitor_rates',
      'ingest.events',
      'engine.generate_recommendations',
    ]);
    expect(jobBodies[0].payload).toEqual({ city: 'Sibiu', property_id: PROPERTY_ID });
    expect(jobBodies[1].payload).toEqual({ city: 'Sibiu' });
    expect(jobBodies[2].payload).toEqual({ property_id: PROPERTY_ID, horizon_days: 90 });

    // Once the pipeline succeeds, the step polls for a pending
    // recommendation; the mocked GET .../recommendations starts returning it.
    recommendationRows = [firstRecommendation];

    expect(
      await screen.findByText('August is peak season in Sibiu.', {}, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/399,00\sRON/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /looks good — take me in/i }));
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('shows an already-generated recommendation immediately on a resumed session', async () => {
    propertyRows = [resolvedWithRooms];
    competitorRows = discoveredCompetitors;
    recommendationRows = [firstRecommendation];
    renderWithProviders(<SetupWizard />);

    expect(await screen.findByText('August is peak season in Sibiu.')).toBeInTheDocument();
    expect(screen.getByText(/399,00\sRON/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me my first price' })).not.toBeInTheDocument();
  });

  it('a failing job stops the pipeline and shows the failed state with a retry', async () => {
    propertyRows = [resolvedWithRooms];
    competitorRows = discoveredCompetitors;
    recommendationRows = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/properties')) return jsonResponse(propertyRows);
      if (method === 'GET' && url.includes('/competitors')) return jsonResponse(competitorRows);
      if (method === 'GET' && url.includes('/recommendations')) return jsonResponse(recommendationRows);
      if (method === 'POST' && url.endsWith('/jobs')) {
        const body = JSON.parse(String(init?.body)) as JobBody;
        jobBodies.push(body);
        if (jobBodies.length === 1) {
          return jsonResponse({ error: 'boom' }, 500);
        }
        return jsonResponse(
          { id: '00000000-0000-4000-8000-000000000001', type: body.type, status: 'queued', createdAt: new Date().toISOString() },
          202,
        );
      }
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });

    renderWithProviders(<SetupWizard />);
    const button = await screen.findByRole('button', { name: 'Show me my first price' });
    fireEvent.click(button);

    expect(
      await screen.findByText("We couldn't work out your first price just now."),
    ).toBeInTheDocument();
    expect(jobBodies).toHaveLength(1);
  });
});

describe('SetupGuard', () => {
  it('redirects an already set-up owner (>=1 property) to the dashboard', async () => {
    propertyRows = [resolvedWithRooms];
    renderWithProviders(<SetupGuard />, {
      route: '/setup',
      path: '/setup',
      routes: [{ path: '/', element: <p>dashboard</p> }],
    });
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('renders the wizard for an owner with no properties yet', async () => {
    propertyRows = [];
    renderWithProviders(<SetupGuard />, {
      route: '/setup',
      path: '/setup',
      routes: [{ path: '/', element: <p>dashboard</p> }],
    });
    expect(await screen.findByRole('heading', { name: "What's your hotel called?" })).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });
});
