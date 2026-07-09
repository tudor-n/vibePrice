/**
 * Shared "long-running server action" status region: working (with a
 * timed escalation to slow affordances), done, and failed. The internal
 * setTimeout working→slow escalation is the only place timeout logic
 * lives — callers just pass the current phase.
 */

import { useEffect, useState } from 'react';

export type AsyncPhase = 'working' | 'done' | 'failed';

export interface AsyncStatusProps {
  phase: AsyncPhase;
  workingText: string;
  doneText?: string;
  slowText?: string;
  timeoutMs?: number;
  onRetry?: () => void;
  onBackground?: () => void;
}

const DEFAULT_SLOW =
  'This is taking longer than usual. The setup service may not be running.';

export function AsyncStatus({
  phase, workingText, doneText, slowText = DEFAULT_SLOW,
  timeoutMs = 20000, onRetry, onBackground,
}: AsyncStatusProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (phase !== 'working') { setSlow(false); return; }
    const id = setTimeout(() => setSlow(true), timeoutMs);
    return () => clearTimeout(id);
  }, [phase, timeoutMs]);

  if (phase === 'done') {
    return <p className="async-status async-status-done" role="status">{doneText ?? workingText}</p>;
  }
  if (phase === 'failed') {
    return (
      <div className="async-status async-status-failed" role="alert">
        <p>We couldn't reach Google just now.</p>
        {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  // working (possibly escalated to slow)
  return (
    <div className="async-status async-status-working" role="status" aria-live="polite">
      <p>{slow ? slowText : workingText}</p>
      {slow && (
        <div className="async-status-actions">
          {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
          {onBackground && (
            <button type="button" className="btn btn-ghost" onClick={onBackground}>
              Keep working in the background
            </button>
          )}
        </div>
      )}
    </div>
  );
}
