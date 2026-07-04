/**
 * Route guard for everything inside the Layout: requires a non-expired
 * session OR the dev tenant-id override from the Settings page (which keeps
 * the pre-auth developer workflow alive). Everyone else goes to /login.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getActiveSession } from './session';
import { getTenantId } from '../api/client';

export function RequireAuth({ children }: { children: ReactNode }) {
  const authenticated = getActiveSession() !== null || getTenantId() !== null;
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
