import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './States';

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LoadingState', () => {
  it('announces what is loading', () => {
    render(<LoadingState what="your properties" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your properties…');
  });
});

describe('ErrorState', () => {
  it('shows plain, human copy — never the raw error message', () => {
    render(<ErrorState error={new Error('API request failed: 500 Internal Server Error')} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load this. Try refreshing the page.");
    expect(alert).not.toHaveTextContent(/API request failed/);
  });
});

describe('EmptyState', () => {
  it('renders just the message when no action is given (existing callers keep working)', () => {
    renderWithRouter(<EmptyState message="Nothing here yet." />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders an actionable button-link when an action is given', () => {
    renderWithRouter(
      <EmptyState
        message="You haven't set up a hotel yet."
        action={{ label: 'Set up your hotel', to: '/setup' }}
      />,
    );
    expect(screen.getByText("You haven't set up a hotel yet.")).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Set up your hotel' });
    expect(link).toHaveAttribute('href', '/setup');
    expect(link).toHaveClass('btn', 'btn-primary');
  });

  it('fires the action onClick when the button-link is clicked (for /setup guard-clearing)', () => {
    const onClick = vi.fn();
    renderWithRouter(
      <EmptyState
        message="You haven't set up a hotel yet."
        action={{ label: 'Set up your hotel', to: '/setup', onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Set up your hotel' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
