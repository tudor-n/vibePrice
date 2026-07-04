import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getActiveSession,
  getSession,
  isExpired,
  setSession,
} from './session';
import type { UserInfo } from '../api/types';

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

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('session storage', () => {
  it('round-trips a session through set/get', () => {
    setSession({ token: 'jwt-token', expiresAt: futureIso(60), user });
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session?.token).toBe('jwt-token');
    expect(session?.user.displayName).toBe('Demo Owner');
    expect(session?.user.tenantId).toBe(user.tenantId);
  });

  it('returns null when nothing is stored', () => {
    expect(getSession()).toBeNull();
  });

  it('returns null when the stored user JSON is corrupt', () => {
    localStorage.setItem('pricepilot.token', 'jwt-token');
    localStorage.setItem('pricepilot.expiresAt', futureIso(60));
    localStorage.setItem('pricepilot.user', '{not json');
    expect(getSession()).toBeNull();
  });

  it('clearSession removes everything', () => {
    setSession({ token: 'jwt-token', expiresAt: futureIso(60), user });
    clearSession();
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('pricepilot.token')).toBeNull();
    expect(localStorage.getItem('pricepilot.user')).toBeNull();
  });
});

describe('isExpired', () => {
  it('is false for a future expiry', () => {
    setSession({ token: 't', expiresAt: futureIso(60), user });
    const session = getSession();
    expect(session && isExpired(session)).toBe(false);
  });

  it('is true for a past expiry', () => {
    setSession({ token: 't', expiresAt: futureIso(-5), user });
    const session = getSession();
    expect(session && isExpired(session)).toBe(true);
  });

  it('treats an unparseable expiry as expired', () => {
    setSession({ token: 't', expiresAt: 'not-a-date', user });
    const session = getSession();
    expect(session && isExpired(session)).toBe(true);
  });
});

describe('getActiveSession', () => {
  it('returns the session while it is valid', () => {
    setSession({ token: 't', expiresAt: futureIso(60), user });
    expect(getActiveSession()?.token).toBe('t');
  });

  it('returns null for an expired token (treated as logged out)', () => {
    setSession({ token: 't', expiresAt: futureIso(-5), user });
    expect(getActiveSession()).toBeNull();
  });
});
