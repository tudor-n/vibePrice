/**
 * Session storage for the logged-in user.
 *
 * The JWT from POST /auth/login lives in localStorage under `pricepilot.token`,
 * its expiry under `pricepilot.expiresAt`, and the UserInfo payload under
 * `pricepilot.user`. An expired or unparseable session is treated as logged
 * out everywhere (guard, API client, header).
 */

import type { UserInfo } from '../api/types';

const TOKEN_KEY = 'pricepilot.token';
const EXPIRES_AT_KEY = 'pricepilot.expiresAt';
const USER_KEY = 'pricepilot.user';

export interface Session {
  token: string;
  /** ISO date-time after which the token is invalid. */
  expiresAt: string;
  user: UserInfo;
}

export function setSession(session: Session): void {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(EXPIRES_AT_KEY, session.expiresAt);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function getSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = localStorage.getItem(EXPIRES_AT_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !expiresAt || !rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as UserInfo;
    if (typeof user !== 'object' || user === null) return null;
    return { token, expiresAt, user };
  } catch {
    // Corrupt storage — treat as logged out rather than crash.
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem(USER_KEY);
}

/** True when the token's expiry is in the past or unparseable. */
export function isExpired(session: Session): boolean {
  const expiry = Date.parse(session.expiresAt);
  return Number.isNaN(expiry) || expiry <= Date.now();
}

/** The session, but only while its token is still valid. */
export function getActiveSession(): Session | null {
  const session = getSession();
  return session && !isExpired(session) ? session : null;
}
