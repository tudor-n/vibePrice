import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { Layout } from './Layout';
import { PropertyProvider } from '../app/PropertyContext';
import { setSession } from '../auth/session';
import { dismissSetup, isSetupDismissed } from '../app/setupState';
import { renderWithProviders } from '../test/renderWithProviders';
import type { UserInfo } from '../api/types';

const user: UserInfo = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'demo@pricepilot.local',
  displayName: 'Ana Popescu',
  role: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('Layout — navigation', () => {
  it('uses plain-language labels; routes and icons stay unchanged', async () => {
    renderWithProviders(
      <PropertyProvider>
        <Layout />
      </PropertyProvider>,
    );
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });

    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Prices to review' })).toHaveAttribute(
      'href',
      '/recommendations',
    );
    expect(within(nav).getByRole('link', { name: 'Nearby hotels' })).toHaveAttribute(
      'href',
      '/competitors',
    );
    expect(within(nav).getByRole('link', { name: "What's on" })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(within(nav).getByRole('link', { name: 'Your hotel' })).toHaveAttribute(
      'href',
      '/settings',
    );

    // The old jargon labels are gone.
    expect(within(nav).queryByText('Dashboard')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Recommendations')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Competitors')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Events')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Settings')).not.toBeInTheDocument();
  });
});

describe('Layout — logout', () => {
  it('clears the setup-dismissed flag so the next owner on this browser is not mis-routed', async () => {
    // The flag lives in localStorage; without this, owner A's "dismissed"
    // milestone would suppress brand-new owner B's auto-enter into /setup.
    setSession({
      token: 'jwt-abc',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user,
    });
    dismissSetup();

    renderWithProviders(
      <PropertyProvider>
        <Layout />
      </PropertyProvider>,
      { route: '/', path: '/', routes: [{ path: '/login', element: <p>login page</p> }] },
    );

    fireEvent.click(await screen.findByRole('button', { name: /log out/i }));
    expect(isSetupDismissed()).toBe(false);
  });
});
