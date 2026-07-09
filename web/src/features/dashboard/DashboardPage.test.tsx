import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DashboardPage, greetingForHour } from './DashboardPage';
import { SetupGuard } from '../setup/SetupGuard';
import { dismissSetup, isSetupDismissed } from '../setup/setupState';
import { PropertyProvider } from '../../app/PropertyContext';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { ExtraRoute } from '../../test/renderWithProviders';
import { setSession } from '../../auth/session';
import { fixtureRecommendation } from '../../test/fixtures';
import type { Property, UserInfo } from '../../api/types';

const user: UserInfo = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'ana@casaluca.ro',
  displayName: 'Ana Popescu',
  role: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
};

const property: Property = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Casa Luca',
  city: 'Sibiu',
  placeStatus: 'resolved',
  placeCandidates: [],
  roomTypes: [
    {
      id: fixtureRecommendation.roomTypeId,
      name: 'Double Deluxe',
      capacity: 2,
      basePrice: 350,
      currentPrice: 350,
      currency: 'RON',
    },
  ],
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
let jobBodies: JobBody[] = [];
let propertyRows: Property[] = [];

beforeEach(() => {
  jobBodies = [];
  propertyRows = [property];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? 'GET';
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
    if (url.includes('/recommendations')) {
      return jsonResponse([fixtureRecommendation]);
    }
    if (url.endsWith('/properties')) {
      return jsonResponse(propertyRows);
    }
    if (url.includes('/events')) {
      return jsonResponse([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  });
  setSession({
    token: 'jwt-abc',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user,
  });
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderDashboard(nowHour: number, routes: ExtraRoute[] = []) {
  return renderWithProviders(
    <PropertyProvider>
      <DashboardPage nowHour={nowHour} />
    </PropertyProvider>,
    { route: '/', path: '/', routes },
  );
}

describe('greetingForHour', () => {
  it('maps hours to morning/afternoon/evening', () => {
    expect(greetingForHour(5)).toBe('Good morning');
    expect(greetingForHour(11)).toBe('Good morning');
    expect(greetingForHour(12)).toBe('Good afternoon');
    expect(greetingForHour(17)).toBe('Good afternoon');
    expect(greetingForHour(18)).toBe('Good evening');
    expect(greetingForHour(23)).toBe('Good evening');
    expect(greetingForHour(2)).toBe('Good evening');
  });
});

describe('DashboardPage', () => {
  it('greets the signed-in owner by first name, time-of-day aware', async () => {
    renderDashboard(9);
    expect(
      await screen.findByRole('heading', { name: 'Good morning, Ana' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Casa Luca · Sibiu — here's what changed while you slept\./),
    ).toBeInTheDocument();
  });

  it('greets differently in the evening', async () => {
    renderDashboard(21);
    expect(
      await screen.findByRole('heading', { name: 'Good evening, Ana' }),
    ).toBeInTheDocument();
  });

  it('refresh enqueues the three pipeline jobs in order with their payloads', async () => {
    renderDashboard(9);
    const button = await screen.findByRole('button', { name: /refresh data now/i });

    fireEvent.click(button);

    await waitFor(() => {
      expect(jobBodies).toHaveLength(3);
    });
    expect(jobBodies.map((body) => body.type)).toEqual([
      'scrape.competitor_rates',
      'ingest.events',
      'engine.generate_recommendations',
    ]);
    expect(jobBodies[0].payload).toEqual({
      city: 'Sibiu',
      property_id: property.id,
    });
    expect(jobBodies[1].payload).toEqual({ city: 'Sibiu' });
    expect(jobBodies[2].payload).toEqual({
      property_id: property.id,
      horizon_days: 90,
    });

    // Once all three are accepted the button settles and the owner is told.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /refresh data now/i }),
      ).toBeEnabled();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/refresh queued/i);
  });

  it('a failing job in the refresh sequence stops it, shows the error, and re-enables', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/jobs')) {
        const body = JSON.parse(String(init?.body)) as JobBody;
        jobBodies.push(body);
        // Second job (ingest.events) fails; the engine job must never fire.
        if (jobBodies.length === 2) {
          return jsonResponse({ error: 'boom' }, 500);
        }
        return jsonResponse(
          { id: '00000000-0000-4000-8000-000000000001', type: body.type, status: 'queued', createdAt: new Date().toISOString() },
          202,
        );
      }
      if (url.includes('/recommendations')) return jsonResponse([fixtureRecommendation]);
      if (url.endsWith('/properties')) return jsonResponse([property]);
      if (url.includes('/events')) return jsonResponse([]);
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });

    renderDashboard(9);
    const button = await screen.findByRole('button', { name: /refresh data now/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(jobBodies.map((body) => body.type)).toEqual([
      'scrape.competitor_rates',
      'ingest.events', // failed here — the sequence stopped
    ]);
    expect(
      screen.getByRole('button', { name: /refresh data now/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/refresh queued/i)).not.toBeInTheDocument();
  });
});

describe('DashboardPage — no property yet', () => {
  it('auto-redirects a brand-new (zero properties, not dismissed) owner into /setup', async () => {
    propertyRows = [];
    renderDashboard(9, [{ path: '/setup', element: <p>setup wizard</p> }]);

    expect(await screen.findByText('setup wizard')).toBeInTheDocument();
  });

  it('a dismissed, zero-property session shows the re-enter CTA and does NOT redirect', async () => {
    propertyRows = [];
    dismissSetup();
    renderDashboard(9, [{ path: '/setup', element: <p>setup wizard</p> }]);

    expect(
      await screen.findByRole('heading', { name: "Let's set up your hotel" }),
    ).toBeInTheDocument();
    expect(screen.queryByText('setup wizard')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start setup/i });
    expect(link).toHaveAttribute('href', '/setup');
  });

  it('clicking the re-enter CTA clears the dismissed flag and heads to /setup', async () => {
    propertyRows = [];
    dismissSetup();
    renderDashboard(9, [{ path: '/setup', element: <p>setup wizard</p> }]);

    fireEvent.click(await screen.findByRole('link', { name: /start setup/i }));
    expect(isSetupDismissed()).toBe(false);
    expect(await screen.findByText('setup wizard')).toBeInTheDocument();
  });
});

describe('DashboardPage — resume nudge (property present but setup unfinished)', () => {
  const resolvedNoRooms: Property = { ...property, placeStatus: 'resolved', roomTypes: [] };

  it('shows a "Finish setting up" link when the property has no room types yet', async () => {
    propertyRows = [resolvedNoRooms];
    renderDashboard(9);

    const link = await screen.findByRole('link', { name: /finish setting up/i });
    expect(link).toHaveAttribute('href', '/setup');
  });

  it('does not show the resume nudge for a fully set-up property', async () => {
    propertyRows = [property]; // resolved + has a room type
    renderDashboard(9);

    await screen.findByRole('heading', { name: /good morning/i });
    expect(screen.queryByRole('link', { name: /finish setting up/i })).not.toBeInTheDocument();
  });
});

describe('DashboardPage — no redirect loop', () => {
  it('zero-property, not-dismissed owner settles on the wizard (dashboard → /setup → wizard, terminates)', async () => {
    // The dashboard redirects / → /setup (zero props, not dismissed); the guard
    // renders the wizard rather than bouncing back — so this terminates at
    // step 1 instead of ping-ponging.
    propertyRows = [];
    renderDashboard(9, [{ path: '/setup', element: <SetupGuard /> }]);

    expect(
      await screen.findByRole('heading', { name: "What's your hotel called?" }),
    ).toBeInTheDocument();
  });
});
