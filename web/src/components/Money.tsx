/**
 * Money display. Formatting only — never compute amounts in the client;
 * the server's numbers are the truth (see root CLAUDE.md hard rules).
 * Every money-display helper in the app lives here.
 */

export interface FormatMoneyOptions {
  /**
   * Drop the ",00" on whole amounts (tight spots like calendar day cells).
   * Never rounds: non-integer amounts keep their fraction digits.
   */
  stripWholeFraction?: boolean;
}

export function formatMoney(
  amount: number,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const formatOptions: Intl.NumberFormatOptions = { style: 'currency', currency };
  if (options.stripWholeFraction) {
    // ES2023 option; engines without it simply ignore the key (keeps ",00").
    (formatOptions as Record<string, unknown>).trailingZeroDisplay = 'stripIfInteger';
  }
  return new Intl.NumberFormat('ro-RO', formatOptions).format(amount);
}

/**
 * Number-only money rendering for captions whose currency is stated by the
 * figure right next to them (e.g. the calendar's "vs 380–455" band caption,
 * where the price above carries the currency). Same locale, no rounding
 * beyond the server's own 2 decimals.
 */
export function formatMoneyBare(amount: number): string {
  return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(amount);
}

interface MoneyProps {
  amount: number;
  currency: string;
  className?: string;
}

export function Money({ amount, currency, className }: MoneyProps) {
  return (
    <span className={className ? `money ${className}` : 'money'}>
      {formatMoney(amount, currency)}
    </span>
  );
}
