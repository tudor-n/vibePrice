/**
 * Small accessible "?" popover for defining jargon inline, e.g. next to a
 * factor label in a recommendation card. No dependencies: plain button +
 * absolutely-positioned tooltip span, closed by Escape or an outside click.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ExplainerProps {
  label: string;
  children: ReactNode;
}

export function Explainer({ label, children }: ExplainerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function handleOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  return (
    <span className="explainer" ref={rootRef}>
      <button
        type="button"
        className="explainer-trigger"
        aria-label={`What does "${label}" mean?`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open && (
        <span id={tooltipId} role="tooltip" className="explainer-popover">
          {children}
        </span>
      )}
    </span>
  );
}
