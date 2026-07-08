import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyBare, Money } from './Money';

// Intl may emit no-break / narrow no-break spaces; \s matches them all.
describe('formatMoney', () => {
  it('formats whole RON amounts in ro-RO style', () => {
    expect(formatMoney(413, 'RON')).toMatch(/^413,00\sRON$/);
  });

  it('uses dot thousands separator and comma decimals for RON', () => {
    expect(formatMoney(3400.5, 'RON')).toMatch(/^3\.400,50\sRON$/);
  });

  it('formats negative amounts with a minus sign', () => {
    expect(formatMoney(-120, 'RON')).toMatch(/^[-−]120,00\sRON$/);
  });

  it('stripWholeFraction drops ,00 on whole amounts but never rounds', () => {
    expect(formatMoney(440, 'RON', { stripWholeFraction: true })).toMatch(
      /^440\sRON$/,
    );
    expect(formatMoney(412.5, 'RON', { stripWholeFraction: true })).toMatch(
      /^412,50\sRON$/,
    );
  });
});

describe('formatMoneyBare', () => {
  it('renders the number alone (currency stated by the adjacent figure)', () => {
    expect(formatMoneyBare(380)).toBe('380');
    expect(formatMoneyBare(412.5)).toBe('412,5');
    expect(formatMoneyBare(1234)).toMatch(/^1\.234$/);
  });
});

describe('Money', () => {
  it('renders the formatted amount with currency', () => {
    render(<Money amount={413} currency="RON" />);
    expect(screen.getByText(/413,00\sRON/)).toBeInTheDocument();
  });
});
