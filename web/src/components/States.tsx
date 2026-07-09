/**
 * Tiny shared loading / error / empty state blocks so every page
 * handles all three without repeating markup.
 */

import { Link } from 'react-router-dom';

export function LoadingState({ what = 'data' }: { what?: string }) {
  return (
    <p className="state state-loading" role="status">
      Loading {what}…
    </p>
  );
}

export function ErrorState({ error: _error }: { error: unknown }) {
  // Raw ApiError/HTTP text is developer-facing, not owner-facing — this
  // block always shows the same plain, human copy regardless of cause.
  return (
    <p className="state state-error" role="alert">
      We couldn&apos;t load this. Try refreshing the page.
    </p>
  );
}

export interface EmptyStateAction {
  label: string;
  to: string;
  /**
   * Optional side-effect fired on click, before navigation. Needed for
   * `/setup` links: SetupGuard bounces /setup → / whenever the
   * setup-dismissed flag is set (every owner past onboarding), so those
   * call sites pass `onClick={() => clearSetupDismissed()}` to un-bounce
   * themselves — mirroring DashboardPage's /setup links.
   */
  onClick?: () => void;
}

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: EmptyStateAction;
}) {
  return (
    <div className="state state-empty">
      <p>{message}</p>
      {action && (
        <Link to={action.to} className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
