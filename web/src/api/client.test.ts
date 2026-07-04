import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  UnauthorizedError,
  apiFetch,
  authRedirect,
  login,
  setTenantId,
} from './client';
import { getSession, setSession } from '../auth/session';
import type { UserInfo } from './types';

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

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(authRedirect, 'toLogin').mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sentHeaders(): Headers {
  const init = fetchMock.mock.calls[0][1];
  return new Headers(init?.headers);
}

describe('apiFetch auth headers', () => {
  it('attaches Authorization: Bearer when a valid token exists', async () => {
    setSession({ token: 'jwt-abc', expiresAt: futureIso(60), user });
    setTenantId('dev-tenant'); // must be ignored while a token exists
    fetchMock.mockResolvedValueOnce(okResponse([]));

    await apiFetch('/properties');

    const headers = sentHeaders();
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(headers.get('X-Tenant-Id')).toBeNull();
  });

  it('falls back to X-Tenant-Id when there is no token (dev workflow)', async () => {
    setTenantId('11111111-1111-4111-8111-111111111111');
    fetchMock.mockResolvedValueOnce(okResponse([]));

    await apiFetch('/properties');

    const headers = sentHeaders();
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Tenant-Id')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('does not send an expired token', async () => {
    setSession({ token: 'jwt-old', expiresAt: futureIso(-5), user });
    fetchMock.mockResolvedValueOnce(okResponse([]));

    await apiFetch('/properties');

    expect(sentHeaders().get('Authorization')).toBeNull();
  });
});

describe('apiFetch 401 handling', () => {
  it('clears the session, redirects to /login and throws UnauthorizedError', async () => {
    setSession({ token: 'jwt-abc', expiresAt: futureIso(60), user });
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(apiFetch('/properties')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(getSession()).toBeNull();
    expect(authRedirect.toLogin).toHaveBeenCalledOnce();
  });

  it('UnauthorizedError is still an ApiError with status 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    const error = await apiFetch('/properties').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });
});

describe('login', () => {
  it('POSTs credentials to /auth/login and stores the session', async () => {
    const payload = { token: 'jwt-new', expiresAt: futureIso(60), user };
    fetchMock.mockResolvedValueOnce(okResponse(payload));

    const result = await login('demo@pricepilot.local', 'Demo1234!');

    expect(fetchMock.mock.calls[0][0]).toContain('/auth/login');
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'demo@pricepilot.local',
      password: 'Demo1234!',
    });
    expect(result.token).toBe('jwt-new');
    expect(getSession()?.token).toBe('jwt-new');
    expect(getSession()?.user.email).toBe('demo@pricepilot.local');
  });

  it('throws on 401 without redirecting (the login page shows the error)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(login('demo@pricepilot.local', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(getSession()).toBeNull();
    expect(authRedirect.toLogin).not.toHaveBeenCalled();
  });
});
