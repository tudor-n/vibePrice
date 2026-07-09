/**
 * Guard for the full-screen /setup destination: an owner who already has
 * >=1 property is "set up" and belongs back on the dashboard. Otherwise
 * render the wizard. (The reverse nudge — routing a no-property owner INTO
 * /setup from the dashboard — is a later task.)
 */

import { Navigate } from 'react-router-dom';
import { useProperties } from '../../api/hooks';
import { ErrorState, LoadingState } from '../../components/States';
import { SetupWizard } from './SetupWizard';

export function SetupGuard() {
  const properties = useProperties();

  if (properties.isPending) {
    return (
      <div className="setup">
        <div className="setup-shell">
          <LoadingState what="your account" />
        </div>
      </div>
    );
  }
  if (properties.isError) {
    return (
      <div className="setup">
        <div className="setup-shell">
          <ErrorState error={properties.error} />
        </div>
      </div>
    );
  }
  if ((properties.data?.length ?? 0) > 0) {
    return <Navigate to="/" replace />;
  }
  return <SetupWizard />;
}
