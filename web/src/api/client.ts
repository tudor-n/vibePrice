/**
 * Tiny typed fetch wrapper for the PricePilot API.
 *
 * - Base URL from VITE_API_BASE_URL (defaults to local backend).
 * - When a valid session token exists, sends `Authorization: Bearer <token>`.
 *   Without a token it falls back to the dev-only `X-Tenant-Id` header from
 *   localStorage (Settings page) so the tenant-override workflow keeps working.
 * - On 401 the session is cleared and the browser is sent to /login
 *   (a distinct UnauthorizedError is thrown so callers can ignore it).
 * - Throws ApiError on any other non-2xx response.
 */

import {
  clearSession,
  getActiveSession,
  setSession,
} from '../auth/session';
import type { LoginRequest, LoginResponse } from './types';

const DEFAULT_BASE_URL = 'http://localhost:8080/api/v1';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;

const TENANT_STORAGE_KEY = 'pricepilot.tenantId';

export function getTenantId(): string | null {
  return localStorage.getItem(TENANT_STORAGE_KEY);
}

export function setTenantId(tenantId: string): void {
  if (tenantId.trim() === '') {
    localStorage.removeItem(TENANT_STORAGE_KEY);
  } else {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId.trim());
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`API request failed: ${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Thrown on 401 — the client already cleared the session and redirected. */
export class UnauthorizedError extends ApiError {
  constructor(statusText: string, body: string) {
    super(401, statusText, body);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Navigation seam: the API client lives outside the router, so an expired
 * session sends the browser to /login directly. Object-wrapped so tests can
 * spy on it (jsdom cannot navigate).
 */
export const authRedirect = {
  toLogin(): void {
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  },
};

interface ApiFetchOptions {
  /**
   * When false, a 401 only throws UnauthorizedError without clearing the
   * session or redirecting — used by login itself, where 401 means
   * "wrong credentials", not "session expired".
   */
  redirectOn401?: boolean;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  { redirectOn401 = true }: ApiFetchOptions = {},
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const session = getActiveSession();
  if (session) {
    headers.set('Authorization', `Bearer ${session.token}`);
  } else {
    // Dev-only fallback: tenant override from the Settings page.
    const tenantId = getTenantId();
    if (tenantId) {
      headers.set('X-Tenant-Id', tenantId);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  if (response.status === 401) {
    if (redirectOn401) {
      clearSession();
      authRedirect.toLogin();
    }
    throw new UnauthorizedError(response.statusText, text);
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, text);
  }
  // Some endpoints (e.g. POST .../status) return an empty 200 body.
  return text === '' ? (undefined as T) : (JSON.parse(text) as T);
}

/**
 * POST /auth/login — exchanges credentials for a JWT and stores the session.
 * Throws UnauthorizedError on wrong credentials (no redirect).
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const body: LoginRequest = { email, password };
  const result = await apiFetch<LoginResponse>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify(body) },
    { redirectOn401: false },
  );
  setSession(result);
  return result;
}
