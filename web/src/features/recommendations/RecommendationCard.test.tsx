import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixtureFactors, fixtureRecommendation } from '../../test/fixtures';
import { RecommendationCard } from './RecommendationCard';

describe('RecommendationCard', () => {
  it('renders the price change from current to recommended', () => {
    render(<RecommendationCard recommendation={fixtureRecommendation} />);
    // 350 RON also appears in the base-price note, so query all occurrences.
    expect(screen.getAllByText(/350,00\sRON/).length).toBeGreaterThan(0);
    expect(screen.getByText(/413,00\sRON/)).toBeInTheDocument();
    expect(screen.getByText(/recommended/)).toBeInTheDocument();
  });

  it('renders every factor reason as plain language, including unknown rules', () => {
    render(<RecommendationCard recommendation={fixtureRecommendation} />);
    for (const factor of fixtureFactors.factors) {
      expect(screen.getByText(factor.reason)).toBeInTheDocument();
    }
    // The unknown-rule factor must still render its reason (engine_version
    // forward compatibility).
    expect(
      screen.getByText('A brand-new engine signal this dashboard version does not know.'),
    ).toBeInTheDocument();
  });

  it('renders +/- percentage chips for the adjustments', () => {
    render(<RecommendationCard recommendation={fixtureRecommendation} />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('-2%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders the expected impact estimate and period from the factors payload', () => {
    render(<RecommendationCard recommendation={fixtureRecommendation} />);
    expect(screen.getByText(/3\.400,00\sRON/)).toBeInTheDocument();
    expect(screen.getByText(/between 12 Jun 2026 and 21 Jun 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/occupancy-weighted delta vs current price/),
    ).toBeInTheDocument();
  });

  it('calls the accept and dismiss handlers with the recommendation id', () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(
      <RecommendationCard
        recommendation={fixtureRecommendation}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /accept price/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onAccept).toHaveBeenCalledWith(fixtureRecommendation.id);
    expect(onDismiss).toHaveBeenCalledWith(fixtureRecommendation.id);
  });

  it('falls back gracefully when the factors list is missing', () => {
    const withoutFactors = {
      ...fixtureRecommendation,
      factors: { ...fixtureFactors, factors: [] },
    };
    render(<RecommendationCard recommendation={withoutFactors} />);
    expect(
      screen.getByText(/Reasoning details are unavailable/),
    ).toBeInTheDocument();
  });
});
