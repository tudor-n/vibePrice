/**
 * Renders a data-freshness timestamp as plain language, e.g.
 * "prices updated 3h ago", with a visible warning once older than
 * `staleAfterHours` (default 24h). Owners must always know how fresh
 * the data behind a recommendation is.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function formatAge(ageMs: number): string {
  if (ageMs < MINUTE_MS) return 'just now';
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)}m ago`;
  if (ageMs < 2 * DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h ago`;
  return `${Math.floor(ageMs / DAY_MS)}d ago`;
}

interface FreshnessBadgeProps {
  /** What was updated, e.g. "prices", "events". */
  label?: string;
  /** ISO timestamp; undefined renders a "no data yet" badge. */
  timestamp?: string;
  staleAfterHours?: number;
}

export function FreshnessBadge({
  label = 'prices',
  timestamp,
  staleAfterHours = 24,
}: FreshnessBadgeProps) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  if (Number.isNaN(parsed)) {
    return <span className="freshness freshness-stale">{label}: no data yet</span>;
  }

  const ageMs = Math.max(0, Date.now() - parsed);
  const stale = ageMs > staleAfterHours * HOUR_MS;

  return (
    <span className={stale ? 'freshness freshness-stale' : 'freshness'}>
      {label} updated {formatAge(ageMs)}
      {stale && (
        <strong className="freshness-warning"> — may be out of date</strong>
      )}
    </span>
  );
}
