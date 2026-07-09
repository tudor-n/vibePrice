import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SetupWizard } from './SetupWizard';
import { SetupGuard } from './SetupGuard';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Property } from '../../api/types';

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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();
let propertyRows: Property[] = [];
let lastCreateBody: unknown = null;
let lastPickBody: unknown = null;
let lastRoomBody: unknown = null;

beforeEach(() => {
  propertyRows = [];
  lastCreateBody = null;
  lastPickBody = null;
  lastRoomBody = null;
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

describe('SetupWizard — step 4 placeholder', () => {
  it('renders a placeholder once the property has room types (steps 4-5 land later)', async () => {
    propertyRows = [resolvedWithRooms];
    renderWithProviders(<SetupWizard />);
    expect(await screen.findByRole('heading', { name: /finding your competitors/i })).toBeInTheDocument();
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
