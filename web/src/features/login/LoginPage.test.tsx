import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import { getSession } from '../../auth/session';
import type { UserInfo } from '../../api/types';
import { renderWithProviders } from '../../test/renderWithProviders';

const user: UserInfo = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'demo@pricepilot.local',
  displayName: 'Demo Owner',
  role: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderLoginPage() {
  return renderWithProviders(<LoginPage />, {
    route: '/login',
    path: '/login',
    routes: [{ path: '/', element: <p>dashboard home</p> }],
  });
}

function submitCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginPage', () => {
  it('stores the session and redirects to / on success', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ token: 'jwt-abc', expiresAt, user }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderLoginPage();
    submitCredentials('demo@pricepilot.local', 'Demo1234!');

    await waitFor(() => {
      expect(screen.getByText('dashboard home')).toBeInTheDocument();
    });
    expect(getSession()?.token).toBe('jwt-abc');
    expect(getSession()?.user.displayName).toBe('Demo Owner');
  });

  it('shows the Romanian credentials error on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 401, statusText: 'Unauthorized' }),
    );

    renderLoginPage();
    submitCredentials('demo@pricepilot.local', 'wrong-password');

    expect(
      await screen.findByText('Email sau parolă greșită.'),
    ).toBeInTheDocument();
    expect(getSession()).toBeNull();
    expect(screen.queryByText('dashboard home')).not.toBeInTheDocument();
  });

  it('shows the demo credentials hint in dev builds', () => {
    // Vitest runs with import.meta.env.DEV === true, like `npm run dev`.
    renderLoginPage();
    expect(screen.getByText(/demo@pricepilot\.local/)).toBeInTheDocument();
    expect(screen.getByText(/Demo1234!/)).toBeInTheDocument();
  });
});
