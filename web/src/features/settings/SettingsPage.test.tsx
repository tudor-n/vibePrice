import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { dismissSetup, isSetupDismissed } from '../../app/setupState';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Property } from '../../api/types';

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';

const unresolvedProperty: Property = {
  id: PROPERTY_ID,
  name: 'Casa Luca',
  city: 'Sibiu',
  placeStatus: 'unresolved',
  placeCandidates: [],
  roomTypes: [],
};

const resolvedProperty: Property = {
  id: PROPERTY_ID,
  name: 'Casa Luca',
  city: 'Sibiu',
  address: 'Strada Nicolae Bălcescu 12, Sibiu',
  latitude: 45.7983,
  longitude: 24.1256,
  rating: 4.5,
  ratingCount: 200,
  placeStatus: 'resolved',
  placeCandidates: [
    {
      placeId: 'place-1',
      name: 'Casa Luca',
      formattedAddress: 'Strada Nicolae Bălcescu 12, Sibiu',
      rating: 4.5,
      ratingCount: 200,
    },
    {
      placeId: 'place-2',
      name: 'Casa Luca Boutique',
      formattedAddress: 'Strada Mitropoliei 5, Sibiu',
      rating: 4.2,
      ratingCount: 80,
    },
  ],
  roomTypes: [],
};

const failedProperty: Property = {
  id: PROPERTY_ID,
  name: 'Casa Luca',
  city: 'Sibiu',
  placeStatus: 'failed',
  placeCandidates: [],
  roomTypes: [],
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
let lastResolveBody: unknown = null;

beforeEach(() => {
  propertyRows = [];
  lastCreateBody = null;
  lastPickBody = null;
  lastResolveBody = null;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.endsWith('/properties')) {
      lastCreateBody = JSON.parse(String(init?.body));
      propertyRows = [unresolvedProperty];
      return jsonResponse(unresolvedProperty, 201);
    }
    if (method === 'PATCH' && url.includes('/place')) {
      lastPickBody = JSON.parse(String(init?.body));
      propertyRows = [resolvedProperty];
      return jsonResponse(resolvedProperty, 200);
    }
    if (method === 'POST' && url.includes('/resolve-place')) {
      lastResolveBody = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(
        { id: 'job-1', type: 'resolve_place', status: 'queued', createdAt: new Date().toISOString() },
        202,
      );
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

describe('SettingsPage — plain-language copy', () => {
  it('titles the page "Your hotel"', async () => {
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByRole('heading', { name: 'Your hotel' })).toBeInTheDocument();
  });
});

describe('SettingsPage — loading/error/empty', () => {
  it('shows a loading state while properties load', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/Loading your properties/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no properties yet', async () => {
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText(/No properties yet/)).toBeInTheDocument();
    // The add-property form is always available, even with zero properties.
    expect(screen.getByLabelText('Property name')).toBeInTheDocument();
  });
});

describe('SettingsPage — add a property (create → resolving)', () => {
  it('creates a property from name + city and shows the resolving state', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText(/No properties yet/);

    fireEvent.change(screen.getByLabelText('Property name'), {
      target: { value: 'Casa Luca' },
    });
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Sibiu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));

    await waitFor(() => {
      expect(lastCreateBody).toEqual({ name: 'Casa Luca', city: 'Sibiu' });
    });

    expect(await screen.findByText('Finding your place on Google…')).toBeInTheDocument();
  });

  it('disables Add property until both fields are filled', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText(/No properties yet/);
    expect(screen.getByRole('button', { name: 'Add property' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Property name'), {
      target: { value: 'Casa Luca' },
    });
    expect(screen.getByRole('button', { name: 'Add property' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Sibiu' } });
    expect(screen.getByRole('button', { name: 'Add property' })).toBeEnabled();
  });
});

describe('SettingsPage — resolved property card', () => {
  it('shows name, address, rating and a coordinate chip', async () => {
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);

    const addressLine = await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');
    const summary = addressLine.closest('.place-summary') as HTMLElement;
    expect(within(summary).getByText(/★ 4.5 \(200 reviews\)/)).toBeInTheDocument();
    expect(within(summary).getByText(/45\.7983, 24\.1256/)).toBeInTheDocument();
  });

  it('lets the owner pick a different candidate via "Not the right place?"', async () => {
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');

    fireEvent.click(screen.getByText('Not the right place?'));
    const otherOption = screen.getByLabelText(/Casa Luca Boutique/);
    fireEvent.click(otherOption);
    fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));

    await waitFor(() => {
      expect(lastPickBody).toEqual({ placeId: 'place-2' });
    });
  });

  it('lets the owner search again by a different name', async () => {
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');

    fireEvent.click(screen.getByText('Not the right place?'));
    fireEvent.change(screen.getByLabelText('Search by a different name'), {
      target: { value: 'Pensiunea Rustic Brasov' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));

    await waitFor(() => {
      expect(lastResolveBody).toEqual({ query: 'Pensiunea Rustic Brasov' });
    });
  });

  it('a blank "search again" re-searches using the property\'s own name (converts \'\' to undefined)', async () => {
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');

    fireEvent.click(screen.getByText('Not the right place?'));
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));

    await waitFor(() => {
      expect(lastResolveBody).toEqual({});
    });
  });
});

describe('SettingsPage — room types', () => {
  it('offers an actionable way to add a room type when a resolved property has none', async () => {
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');

    expect(screen.getByText("You haven't added a room type yet.")).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /add a room type/i });
    expect(link).toHaveAttribute('href', '/setup');
  });

  it('clears the setup-dismissed flag when "Add a room type" is clicked (so SetupGuard does not bounce /setup)', async () => {
    // Regression guard for the returning-owner dead end: SetupGuard sends
    // /setup → / whenever the dismissed flag is set (every owner past
    // onboarding), so the /setup action must clear it, like DashboardPage's
    // links do. Concretely reachable via a second property added in Settings.
    dismissSetup();
    propertyRows = [resolvedProperty];
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Strada Nicolae Bălcescu 12, Sibiu');

    fireEvent.click(screen.getByRole('link', { name: /add a room type/i }));
    expect(isSetupDismissed()).toBe(false);
  });
});

describe('SettingsPage — failed property card', () => {
  it('shows "we could not find it" plus a re-search box, no candidate list', async () => {
    propertyRows = [failedProperty];
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText(/couldn't find it/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Search by a different name')).toBeInTheDocument();
    expect(screen.queryByText('Not the right place?')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search by a different name'), {
      target: { value: 'Casa Luca Sibiu centru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));

    await waitFor(() => {
      expect(lastResolveBody).toEqual({ query: 'Casa Luca Sibiu centru' });
    });
  });
});
