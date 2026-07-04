/**
 * Tiny typed fetch wrapper for the PricePilot API.
 *
 * - Base URL from VITE_API_BASE_URL (defaults to local backend).
 * - Sends X-Tenant-Id from localStorage. TODO: replace with real auth
 *   (token-derived tenant) — this is a dev-only stub.
 * - Throws ApiError on any non-2xx response.
 */

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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const tenantId = getTenantId();
  if (tenantId) {
    headers.set('X-Tenant-Id', tenantId);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, text);
  }
  // Some endpoints (e.g. POST .../status) return an empty 200 body.
  return text === '' ? (undefined as T) : (JSON.parse(text) as T);
}
