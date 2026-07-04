import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FreshnessBadge } from './FreshnessBadge';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

describe('FreshnessBadge', () => {
  it('renders a plain-language relative age for fresh data', () => {
    render(<FreshnessBadge label="prices" timestamp={hoursAgo(3)} />);
    expect(screen.getByText(/prices updated 3h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument();
  });

  it('shows a stale warning when data is older than 24h', () => {
    render(<FreshnessBadge label="prices" timestamp={hoursAgo(30)} />);
    expect(screen.getByText(/prices updated 30h ago/)).toBeInTheDocument();
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
  });

  it('respects a custom stale threshold', () => {
    render(<FreshnessBadge label="events" timestamp={hoursAgo(3)} staleAfterHours={2} />);
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
  });

  it('renders a fallback when there is no timestamp', () => {
    render(<FreshnessBadge label="events" />);
    expect(screen.getByText(/events: no data yet/)).toBeInTheDocument();
  });
});
