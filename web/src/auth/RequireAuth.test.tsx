import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RequireAuth } from './RequireAuth';
import { setSession } from './session';
import { setTenantId } from '../api/client';
import type { UserInfo } from '../api/types';
import { renderWithProviders } from '../test/renderWithProviders';

const user: UserInfo = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'demo@pricepilot.local',
  displayName: 'Demo Owner',
  role: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
};

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function renderGuarded() {
  return renderWithProviders(
    <RequireAuth>
      <p>protected content</p>
    </RequireAuth>,
    { routes: [{ path: '/login', element: <p>login page</p> }] },
  );
}

afterEach(() => {
  localStorage.clear();
});

describe('RequireAuth', () => {
  it('redirects unauthenticated visitors to /login', () => {
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('treats an expired token as logged out', () => {
    setSession({ token: 'jwt-old', expiresAt: futureIso(-5), user });
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('lets a valid session through', () => {
    setSession({ token: 'jwt-abc', expiresAt: futureIso(60), user });
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('lets the dev tenant-id override through (no session)', () => {
    setTenantId('11111111-1111-4111-8111-111111111111');
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});
