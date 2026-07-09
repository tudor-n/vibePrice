/**
 * Guard for the full-screen /setup destination. Routing is driven by the
 * client-side "setup dismissed" milestone (see setupState.ts), NOT by property
 * count: step 1 creates a property, so a property-count guard would eject the
 * owner mid-wizard (before step 2). An owner who has deliberately left the
 * wizard ("Skip for now" / "take me in") is sent to the dashboard; everyone
 * else sees the wizard, resumed at whatever step `useSetupProgress` derives
 * from server state (its own loading/error states are handled there).
 */

import { Navigate } from 'react-router-dom';
import { isSetupDismissed } from './setupState';
import { SetupWizard } from './SetupWizard';

export function SetupGuard() {
  if (isSetupDismissed()) {
    return <Navigate to="/" replace />;
  }
  return <SetupWizard />;
}
