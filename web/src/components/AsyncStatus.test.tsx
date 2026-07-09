import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { AsyncStatus } from './AsyncStatus';

test('shows working text, then slow affordances after the timeout', () => {
  vi.useFakeTimers();
  const onRetry = vi.fn();
  render(<AsyncStatus phase="working" workingText="Finding your place…"
    onRetry={onRetry} onBackground={vi.fn()} timeoutMs={20000} />);
  expect(screen.getByText('Finding your place…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(20000); });
  expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /keep working in the background/i })).toBeInTheDocument();
  vi.useRealTimers();
});

test('failed phase shows retry immediately; done shows done text', () => {
  const onRetry = vi.fn();
  const { rerender } = render(<AsyncStatus phase="failed" workingText="w" onRetry={onRetry} />);
  screen.getByRole('button', { name: /try again/i }).click();
  expect(onRetry).toHaveBeenCalled();
  rerender(<AsyncStatus phase="done" workingText="w" doneText="Found it ✓" />);
  expect(screen.getByText('Found it ✓')).toBeInTheDocument();
});

test('failed phase uses the default copy, or a caller override when given', () => {
  const { rerender } = render(<AsyncStatus phase="failed" workingText="w" />);
  expect(screen.getByText("We couldn't reach Google just now.")).toBeInTheDocument();

  rerender(
    <AsyncStatus
      phase="failed"
      workingText="w"
      failedText="We couldn't refresh your prices just now."
    />,
  );
  expect(
    screen.getByText("We couldn't refresh your prices just now."),
  ).toBeInTheDocument();
  expect(screen.queryByText("We couldn't reach Google just now.")).not.toBeInTheDocument();
});

test('status region is announced to screen readers', () => {
  render(<AsyncStatus phase="working" workingText="Finding…" />);
  expect(screen.getByRole('status')).toHaveTextContent('Finding…');
});
