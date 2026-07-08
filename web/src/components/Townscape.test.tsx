import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Townscape, TownSilhouette } from './Townscape';

describe('Townscape', () => {
  it('renders a decorative svg hidden from assistive tech', () => {
    const { container } = render(<Townscape />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no animation class by default (data screens are static by design)', () => {
    const { container } = render(<Townscape />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('townscape');
    expect(svg).not.toHaveClass('townscape-animated');
  });

  it('adds the animation class only when the animated prop is set', () => {
    const { container } = render(<Townscape animated />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('townscape');
    expect(svg).toHaveClass('townscape-animated');
  });

  it('keeps duplicate instances safe: filter/gradient ids are unique per mount', () => {
    const { container } = render(
      <>
        <Townscape />
        <Townscape />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('TownSilhouette', () => {
  it('renders a decorative svg hidden from assistive tech', () => {
    const { container } = render(<TownSilhouette />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('never animates (silhouettes decorate data screens)', () => {
    const { container } = render(<TownSilhouette />);
    expect(container.querySelector('.townscape-animated')).toBeNull();
  });
});
