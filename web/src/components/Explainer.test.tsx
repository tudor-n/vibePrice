import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Explainer } from './Explainer';

describe('Explainer', () => {
  it('renders a "?" button labelled by the explainer label', () => {
    render(<Explainer label="occupancy factor">Extra detail text</Explainer>);
    expect(
      screen.getByRole('button', { name: /what does "occupancy factor" mean\?/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('toggles a popover containing the children on click', () => {
    render(<Explainer label="occupancy factor">Extra detail text</Explainer>);
    const button = screen.getByRole('button', { name: /what does/i });

    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Extra detail text');

    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('links the popover to the trigger via aria-describedby', () => {
    render(<Explainer label="occupancy factor">Extra detail text</Explainer>);
    const button = screen.getByRole('button', { name: /what does/i });
    fireEvent.click(button);
    const tooltip = screen.getByRole('tooltip');
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('closes on Escape', () => {
    render(<Explainer label="occupancy factor">Extra detail text</Explainer>);
    fireEvent.click(screen.getByRole('button', { name: /what does/i }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <Explainer label="occupancy factor">Extra detail text</Explainer>
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /what does/i }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
